import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ensureBuilt, makeTmpDir, rmDir, runCli, startMockServer, type MockServer } from "./helpers.js";

describe("study commands preserve the API boundary", () => {
  let server: MockServer;
  let dir: string;
  let token: string;
  let responseData: unknown;
  const requests: { method: string | undefined; url: string | undefined; body: string }[] = [];

  beforeAll(async () => {
    ensureBuilt();
    dir = makeTmpDir();
    token = path.join(dir, "token.txt");
    fs.writeFileSync(token, "fake-token");
    server = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        requests.push({ method: req.method, url: req.url, body });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, data: responseData }));
      });
    });
  });

  beforeEach(() => {
    requests.length = 0;
    responseData = null;
  });

  afterAll(async () => {
    await server.close();
    rmDir(dir);
  });

  it.each([
    {
      command: ["status"],
      method: "GET",
      endpoint: "activity",
      body: "",
      data: { sources: { guide: { status: "future-guide-state" }, report: { status: "future-report-state" } } },
    },
    {
      command: ["guide", "get"],
      method: "GET",
      endpoint: "discussion-guide",
      body: "",
      data: { revision: "revision-1", discussion_guide: { meta: { sample_size: 8 } }, extra: null },
    },
    {
      command: ["report", "link"],
      method: "POST",
      endpoint: "report/share-link",
      body: "{}",
      data: { report_url: "https://example.com/report", extra: { expires_at: null } },
    },
  ])("$command makes one request and preserves all response data", async ({ command, method, endpoint, body, data }) => {
    responseData = data;
    const { stdout, stderr, code } = await runCli(
      ["--token", token, "study", ...command, "--study-id", "study-1"],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(data);
    expect(requests).toEqual([{ method, url: `/api/v1/studies/study-1/${endpoint}`, body }]);
  });

  it("rejects the removed guide wait command before making any request", async () => {
    const { stdout, stderr, code } = await runCli(
      ["--token", token, "study", "guide", "wait", "--study-id", "study-1"],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("unknown command 'wait'");
    expect(requests).toEqual([]);
  });
});
