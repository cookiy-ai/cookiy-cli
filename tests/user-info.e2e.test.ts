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
  const p = path.join(dir, "token.txt");
  fs.writeFileSync(p, content);
  return p;
}

describe("user info", () => {
  let server: MockServer;
  const seenPaths: string[] = [];

  beforeAll(async () => {
    server = await startMockServer((req, res) => {
      seenPaths.push(req.url || "");
      expect(req.headers.authorization).toBe("Bearer fake-token");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          limitations: [
            "Qualitative interview duration is limited to 15 minutes maximum",
            "Each operation is billed separately",
            "Realtime interview observation and Knowledge Base are unavailable for real participants",
          ],
        }),
      );
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("calls the REST user info endpoint", async () => {
    const tokenPath = tmpToken("fake-token");

    const { stdout, stderr, code } = await runCli(
      ["--token", tokenPath, "user", "info"],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(seenPaths).toContain("/api/v1/user/info");
    expect(JSON.parse(stdout)).toEqual({
      limitations: [
        "Qualitative interview duration is limited to 15 minutes maximum",
        "Each operation is billed separately",
        "Realtime interview observation and Knowledge Base are unavailable for real participants",
      ],
    });
  });
});
