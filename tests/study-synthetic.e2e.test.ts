import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

beforeAll(() => {
  ensureBuilt();
});

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmDir(tmpDirs.pop()!);
});

function tmpToken(content: string): string {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  const tokenPath = path.join(dir, "token.txt");
  fs.writeFileSync(tokenPath, content);
  return tokenPath;
}

describe("study run-synthetic-user start", () => {
  let server: MockServer;
  let requestBody: unknown;
  let requestMeta: unknown;

  beforeAll(async () => {
    server = await startMockServer((req, res) => {
      requestMeta = { method: req.method, url: req.url, authorization: req.headers.authorization };

      let rawBody = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        rawBody += chunk;
      });
      req.on("end", () => {
        requestBody = JSON.parse(rawBody);
        res.statusCode = 202;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ status: "queued" }));
      });
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("maps --persona to the REST persona field", async () => {
    const tokenPath = tmpToken("fake-token");

    const { stdout, stderr, code } = await runCli(
      [
        "--token",
        tokenPath,
        "study",
        "run-synthetic-user",
        "start",
        "--study-id",
        "study-1",
        "--persona-count",
        "2",
        "--persona",
        "Shanghai coffee consumers",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ status: "queued" });
    expect(requestMeta).toEqual({ method: "POST", url: "/api/v1/studies/study-1/fake-interview", authorization: "Bearer fake-token" });
    expect(requestBody).toEqual({
      persona_count: 2,
      persona: "Shanghai coffee consumers",
    });
  });
});
