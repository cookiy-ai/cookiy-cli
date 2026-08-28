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

function tmpToken(): string {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  const tokenPath = path.join(dir, "token.txt");
  fs.writeFileSync(tokenPath, "fake-token");
  return tokenPath;
}

describe("study wait in-progress timeout contract", () => {
  let server: MockServer;

  beforeAll(async () => {
    server = await startMockServer((req, res) => {
      res.setHeader("content-type", "application/json");

      if (req.url === "/api/v1/studies/guide-study/activity") {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              sources: {
                guide: { status: "guide_generation_in_progress" },
              },
            },
          }),
        );
        return;
      }

      if (req.url === "/api/v1/studies/report-study/activity") {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              sources: {
                report: { status: "report_generation_in_progress" },
              },
            },
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: { message: "Not found" } }));
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns the current guide status through stdout", async () => {
    const { stdout, stderr, code } = await runCli(
      [
        "--token",
        tmpToken(),
        "study",
        "guide",
        "wait",
        "--study-id",
        "guide-study",
        "--timeout-ms",
        "1",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(1);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      status: "guide_generation_in_progress",
    });
  });

  it("returns the current report status through stdout", async () => {
    const { stdout, stderr, code } = await runCli(
      [
        "--token",
        tmpToken(),
        "study",
        "report",
        "wait",
        "--study-id",
        "report-study",
        "--timeout-ms",
        "1",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(1);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      status: "report_generation_in_progress",
    });
  });
});
