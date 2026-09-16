import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ensureBuilt, makeTmpDir, rmDir, runCli, startMockServer, type MockServer } from "./helpers.js";

describe("study wait output contract", () => {
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
      requests.push(req.url ?? "");
      res.setHeader("content-type", "application/json");
      const [, kind, mode] = req.url?.match(/studies\/(guide|report)-(pending|ready|failed|unknown|later-ready|later-failed|later-unknown)\//) ?? [];
      let data: unknown;
      if (req.url?.endsWith("/activity") && kind) {
        const pollCount = requests.filter((url) => url === req.url).length;
        const state = mode.startsWith("later-")
          ? pollCount === 1 ? "pending" : mode.slice("later-".length)
          : mode;
        const status = state === "pending" ? kind + "_generation_in_progress"
          : state === "unknown" ? "unrecognized"
          : state === "failed" && kind === "guide" ? "guide_generation_failed"
          : kind + "_" + state;
        data = { sources: { [kind]: { status } } };
      } else if (req.url?.endsWith("/discussion-guide")) {
        data = { revision: 1, discussion_guide: { meta: { sample_size: 8 } } };
      } else if (req.url?.endsWith("/share-link")) {
        data = { report_url: "https://example.com/report" };
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: { message: "Not found" } }));
        return;
      }
      res.end(JSON.stringify({ ok: true, data }));
    });
  });

  afterAll(async () => {
    await server.close();
    rmDir(dir);
  });

  for (const kind of ["guide", "report"]) {
    it.each(["ready", "failed", "unknown"])(kind + " checks the final poll before reporting timeout: %s", async (state) => {
      const studyId = `${kind}-later-${state}`;
      const { stdout, stderr, code } = await runCli(
        ["--token", token, "study", kind, "wait", "--study-id", studyId, "--timeout-ms", "500"],
        { COOKIY_SERVER_URL: server.url },
      );
      expect(requests.filter((url) => url === `/api/v1/studies/${studyId}/activity`)).toHaveLength(2);
      if (state === "ready") {
        expect(code).toBe(0);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(kind === "guide"
          ? { revision: 1, discussion_guide: { meta: { sample_size: 8 } } }
          : { report_url: "https://example.com/report" });
      } else {
        expect(code).toBe(1);
        expect(stdout).toBe("");
        expect(JSON.parse(stderr)).toEqual({
          code: state === "failed" ? "GENERATION_FAILED" : "UNEXPECTED_STATUS",
          message: expect.any(String),
          details: { status: state === "unknown" ? "unrecognized" : kind === "guide" ? "guide_generation_failed" : "report_failed" },
        });
      }
    });

    it.each([
      ["pending", "WAIT_TIMEOUT", kind + "_generation_in_progress"],
      ["failed", "GENERATION_FAILED", kind === "guide" ? "guide_generation_failed" : "report_failed"],
      ["unknown", "UNEXPECTED_STATUS", "unrecognized"],
    ])(kind + " wait %s writes one JSON error to stderr", async (mode, errorCode, status) => {
      const url = "/api/v1/studies/" + kind + "-" + mode + "/activity";
      const before = requests.filter((r) => r === url).length;
      const { stdout, stderr, code } = await runCli(
        ["--token", token, "study", kind, "wait", "--study-id", kind + "-" + mode, "--timeout-ms", "500"],
        { COOKIY_SERVER_URL: server.url },
      );
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(JSON.parse(stderr)).toEqual({ code: errorCode, message: expect.any(String), details: { status } });
      const requestCount = requests.filter((r) => r === url).length - before;
      if (mode === "pending") expect(requestCount).toBeGreaterThanOrEqual(2);
      else expect(requestCount).toBe(1);
    });

    it(kind + " wait ready writes only the successful result", async () => {
      const { stdout, stderr, code } = await runCli(
        ["--token", token, "study", kind, "wait", "--study-id", kind + "-ready"],
        { COOKIY_SERVER_URL: server.url },
      );
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(kind === "guide"
        ? { revision: 1, discussion_guide: { meta: { sample_size: 8 } } }
        : { report_url: "https://example.com/report" });
    });
  }
});
