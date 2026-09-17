import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  ensureBuilt,
  makeTmpDir,
  rmDir,
  runCli,
  startMockServer,
  type MockServer,
} from "./helpers.js";

const SECOND_POLL_TIMEOUT_MS = 500;
const SHARE_LINK_TIMEOUT_MS = 1000;
const SHARE_LINK_ACTIVITY_DELAY_MS = 600;
const SERVER_TIMING_TOLERANCE_MS = 300;
const LATE_ACTIVITY_TIMEOUT_MS = 500;
const LATE_ACTIVITY_INITIAL_DELAY_MS = 180;
const LARGE_ACTIVITY_ITEM_COUNT = 6_000_000;
const SHARE_LINK_BODY_TIMEOUT_MS = 300;
const SHARE_LINK_BODY_DELAY_MS = 1000;

describe("study report wait", () => {
  let server: MockServer;
  let dir: string;
  let token: string;
  const requests: string[] = [];
  let shareLinkActivityReceivedAt = 0;
  let shareLinkPostReceivedAt = 0;
  let resolveShareLinkPostClosed: ((closedAt: number) => void) | undefined;
  let oversizedFailedActivity: Buffer;

  beforeAll(async () => {
    ensureBuilt();
    dir = makeTmpDir();
    token = path.join(dir, "token.txt");
    fs.writeFileSync(token, "fake-token");
    const padding = `[${"1,".repeat(LARGE_ACTIVITY_ITEM_COUNT - 1)}1]`;
    oversizedFailedActivity = gzipSync(
      `{"ok":true,"data":{"study_id":"late-failed-activity","current_stage":"report_generation_in_progress","sources":{"report":{"status":"report_failed"}},"padding":${padding}}}`,
    );
    server = await startMockServer((req, res) => {
      const url = req.url ?? "";
      requests.push(url);
      res.setHeader("content-type", "application/json");

      const studyId = url.split("/")[4];
      if (url.endsWith("/activity")) {
        const pollCount = requests.filter((request) => request === url).length;
        if (studyId === "second-poll-timeout" && pollCount === 2) {
          return;
        }
        if (studyId === "late-failed-activity" && pollCount === 2) {
          res.setHeader("content-encoding", "gzip");
          res.end(oversizedFailedActivity);
          return;
        }
        let status = "future_report_status";
        if (studyId === "later-ready") {
          status = pollCount === 1
            ? "report_generation_in_progress"
            : "report_ready";
        } else if (studyId === "share-link-timeout") {
          status = "report_ready";
        } else if (
          studyId === "share-link-body-timeout" ||
          studyId === "transport-timeout"
        ) {
          status = "report_ready";
        } else if (studyId === "timeout" || studyId === "second-poll-timeout") {
          status = "report_generation_in_progress";
        } else if (studyId === "late-failed-activity") {
          status = "report_generation_in_progress";
        } else if (studyId === "failed") {
          status = "report_failed";
        } else if (studyId === "not-requested") {
          status = "report_not_requested";
        }
        const response = JSON.stringify({
          ok: true,
          data: {
            study_id: studyId,
            current_stage: "report_generation_in_progress",
            sources: studyId === "missing" ? {} : { report: { status } },
          },
        });
        if (studyId === "share-link-timeout") {
          shareLinkActivityReceivedAt = Date.now();
          setTimeout(() => res.end(response), SHARE_LINK_ACTIVITY_DELAY_MS);
          return;
        }
        if (studyId === "late-failed-activity") {
          setTimeout(() => res.end(response), LATE_ACTIVITY_INITIAL_DELAY_MS);
          return;
        }
        res.end(response);
        return;
      }

      if (url.endsWith("/report/share-link")) {
        if (studyId === "transport-timeout") {
          return;
        }
        if (studyId === "share-link-timeout") {
          shareLinkPostReceivedAt = Date.now();
          res.once("close", () => resolveShareLinkPostClosed?.(Date.now()));
          return;
        }
        if (studyId === "share-link-body-timeout") {
          res.write('{"ok":true,"data":');
          const bodyTimer = setTimeout(() => {
            res.end('{"share_url":"https://example.com/report"}}');
          }, SHARE_LINK_BODY_DELAY_MS);
          res.once("close", () => clearTimeout(bodyTimer));
          return;
        }
        res.end(JSON.stringify({
          ok: true,
          data: {
            study_id: studyId,
            report_status: "report_ready",
            share_url: "https://example.com/report",
          },
        }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: { message: "Not found" } }));
    });
  });

  beforeEach(() => {
    requests.length = 0;
    shareLinkActivityReceivedAt = 0;
    shareLinkPostReceivedAt = 0;
    resolveShareLinkPostClosed = undefined;
  });

  afterAll(async () => {
    await server.close();
    rmDir(dir);
  });

  it("polls until ready and prints the report share link", async () => {
    const result = await runCli(
      [
        "--token",
        token,
        "study",
        "report",
        "wait",
        "--study-id",
        "later-ready",
        "--timeout-ms",
        "1000",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      study_id: "later-ready",
      report_status: "report_ready",
      share_url: "https://example.com/report",
    });
    expect(requests).toEqual([
      "/api/v1/studies/later-ready/activity",
      "/api/v1/studies/later-ready/activity",
      "/api/v1/studies/later-ready/report/share-link",
    ]);
  });

  it("prints the latest complete activity to stdout when the wait times out", async () => {
    const result = await runCli(
      [
        "--token",
        token,
        "study",
        "report",
        "wait",
        "--study-id",
        "timeout",
        "--timeout-ms",
        "100",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      study_id: "timeout",
      current_stage: "report_generation_in_progress",
      sources: { report: { status: "report_generation_in_progress" } },
    });
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(requests.every((url) => url === "/api/v1/studies/timeout/activity")).toBe(true);
  });

  it("prints the last complete activity when a later poll reaches the deadline", async () => {
    const result = await runCli(
      [
        "--token",
        token,
        "study",
        "report",
        "wait",
        "--study-id",
        "second-poll-timeout",
        "--timeout-ms",
        String(SECOND_POLL_TIMEOUT_MS),
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      study_id: "second-poll-timeout",
      current_stage: "report_generation_in_progress",
      sources: { report: { status: "report_generation_in_progress" } },
    });
    expect(requests).toEqual([
      "/api/v1/studies/second-poll-timeout/activity",
      "/api/v1/studies/second-poll-timeout/activity",
    ]);
  });

  it("ignores an Activity response that finishes after the wait deadline", async () => {
    const result = await runCli(
      [
        "--token",
        token,
        "study",
        "report",
        "wait",
        "--study-id",
        "late-failed-activity",
        "--timeout-ms",
        String(LATE_ACTIVITY_TIMEOUT_MS),
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      study_id: "late-failed-activity",
      current_stage: "report_generation_in_progress",
      sources: { report: { status: "report_generation_in_progress" } },
    });
    expect(requests).toEqual([
      "/api/v1/studies/late-failed-activity/activity",
      "/api/v1/studies/late-failed-activity/activity",
    ]);
  });

  it("keeps the share-link request within the report wait deadline", async () => {
    const postClosed = new Promise<number>((resolve) => {
      resolveShareLinkPostClosed = resolve;
    });
    const result = await runCli(
      [
        "--token",
        token,
        "study",
        "report",
        "wait",
        "--study-id",
        "share-link-timeout",
        "--timeout-ms",
        String(SHARE_LINK_TIMEOUT_MS),
      ],
      {
        COOKIY_SERVER_URL: server.url,
        COOKIY_API_RPC_TIMEOUT: "2",
      },
    );
    const shareLinkPostClosedAt = await postClosed;

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      study_id: "share-link-timeout",
      current_stage: "report_generation_in_progress",
      sources: { report: { status: "report_ready" } },
    });
    expect(requests).toEqual([
      "/api/v1/studies/share-link-timeout/activity",
      "/api/v1/studies/share-link-timeout/report/share-link",
    ]);
    const elapsedBeforePost = shareLinkPostReceivedAt - shareLinkActivityReceivedAt;
    const postLifetime = shareLinkPostClosedAt - shareLinkPostReceivedAt;
    const expectedRemainingAtPost = SHARE_LINK_TIMEOUT_MS - elapsedBeforePost;
    expect(elapsedBeforePost).toBeGreaterThanOrEqual(SHARE_LINK_ACTIVITY_DELAY_MS);
    expect(Math.abs(postLifetime - expectedRemainingAtPost))
      .toBeLessThanOrEqual(SERVER_TIMING_TOLERANCE_MS);
  });

  it("keeps the deadline active while reading the share-link response body", async () => {
    const result = await runCli(
      [
        "--token",
        token,
        "study",
        "report",
        "wait",
        "--study-id",
        "share-link-body-timeout",
        "--timeout-ms",
        String(SHARE_LINK_BODY_TIMEOUT_MS),
      ],
      {
        COOKIY_SERVER_URL: server.url,
        COOKIY_API_RPC_TIMEOUT: "2",
      },
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      study_id: "share-link-body-timeout",
      current_stage: "report_generation_in_progress",
      sources: { report: { status: "report_ready" } },
    });
    expect(requests).toEqual([
      "/api/v1/studies/share-link-body-timeout/activity",
      "/api/v1/studies/share-link-body-timeout/report/share-link",
    ]);
  });

  it("preserves an earlier transport timeout before the wait deadline", async () => {
    const result = await runCli(
      [
        "--token",
        token,
        "study",
        "report",
        "wait",
        "--study-id",
        "transport-timeout",
        "--timeout-ms",
        "3000",
      ],
      {
        COOKIY_SERVER_URL: server.url,
        COOKIY_API_RPC_TIMEOUT: "1",
      },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      code: "REQUEST_TIMEOUT",
      message: "[timeout 1s]",
    });
    expect(requests).toEqual([
      "/api/v1/studies/transport-timeout/activity",
      "/api/v1/studies/transport-timeout/report/share-link",
    ]);
  });

  it.each(["0", "-1"])("rejects non-positive timeout %s before making a request", async (timeoutMs) => {
    const result = await runCli(
      [
        "--token",
        token,
        "study",
        "report",
        "wait",
        "--study-id",
        "timeout",
        "--timeout-ms",
        timeoutMs,
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--timeout-ms requires a positive integer");
    expect(requests).toEqual([]);
  });

  it.each([
    ["failed", "GENERATION_FAILED", { status: "report_failed" }],
    ["not-requested", "REPORT_NOT_REQUESTED", { status: "report_not_requested" }],
    ["unknown", "UNEXPECTED_STATUS", { status: "future_report_status" }],
    ["missing", "UNEXPECTED_STATUS", {}],
  ])("fails immediately for %s", async (studyId, errorCode, details) => {
    const result = await runCli(
      ["--token", token, "study", "report", "wait", "--study-id", studyId],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      code: errorCode,
      message: expect.any(String),
      details,
    });
    expect(requests).toEqual([`/api/v1/studies/${studyId}/activity`]);
  });
});
