import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ensureBuilt,
  makeTmpDir,
  rmDir,
  runCli,
  startMockServer,
  type MockServer,
} from "./helpers.js";

describe("study report wait", () => {
  let server: MockServer;
  let dir: string;
  let token: string;
  const requests: string[] = [];

  beforeAll(async () => {
    ensureBuilt();
    dir = makeTmpDir();
    token = path.join(dir, "token.txt");
    fs.writeFileSync(token, "fake-token");
    server = await startMockServer((req, res) => {
      const url = req.url ?? "";
      requests.push(url);
      res.setHeader("content-type", "application/json");

      const studyId = url.split("/")[4];
      if (url.endsWith("/activity")) {
        const pollCount = requests.filter((request) => request === url).length;
        const status = studyId === "later-ready"
          ? pollCount === 1 ? "report_generation_in_progress" : "report_ready"
          : studyId === "timeout"
            ? "report_generation_in_progress"
            : studyId === "failed"
              ? "report_failed"
              : studyId === "not-requested"
                ? "report_not_requested"
                : "future_report_status";
        res.end(JSON.stringify({
          ok: true,
          data: {
            study_id: studyId,
            current_stage: "report_generation_in_progress",
            sources: studyId === "missing" ? {} : { report: { status } },
          },
        }));
        return;
      }

      if (url.endsWith("/report/share-link")) {
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
