import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DIST, ROOT, ensureBuilt, makeTmpDir, rmDir, startMockServer, type MockServer } from "./helpers.js";

describe("output pipe closes early", () => {
  let server: MockServer;
  let dir: string;
  let token: string;

  beforeAll(async () => {
    ensureBuilt();
    dir = makeTmpDir();
    token = path.join(dir, "token.txt");
    fs.writeFileSync(token, "fake-token");
    server = await startMockServer((req, res) => {
      res.setHeader("content-type", "application/json");
      const big = "x".repeat(4_000_000);
      if (req.url?.includes("/failed/")) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: { code: "BAD_REQUEST", message: big } }));
      } else {
        res.end(JSON.stringify({ ok: true, data: { big } }));
      }
    });
  });

  afterAll(async () => {
    await server.close();
    rmDir(dir);
  });

  it("reports non-EPIPE write failures and exits nonzero", async () => {
    // An inherited read-only descriptor makes the real stdout write fail.
    const outputFd = fs.openSync(token, "r");
    try {
      const child = spawn(process.execPath, [DIST, "--token", token, "study", "guide", "get", "--study-id", "success"], {
        cwd: ROOT,
        env: { ...process.env, COOKIY_SERVER_URL: server.url },
        stdio: ["ignore", outputFd, "pipe"],
      });
      let stderr = "";
      child.stderr!.on("data", (data) => { stderr += data; });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      expect(code).toBe(1);
      expect(stderr).toContain("Failed to write output:");
      expect(stderr).toContain("EBADF");
      expect(stderr).not.toContain("Unhandled");
      expect(fs.readFileSync(token, "utf8")).toBe("fake-token");
    } finally {
      fs.closeSync(outputFd);
    }
  });

  it.each(["success", "failed"])("%s keeps its exit status without an EPIPE diagnostic", async (mode) => {
    const child = spawn(process.execPath, [DIST, "--token", token, "study", "guide", "get", "--study-id", mode], {
      cwd: ROOT,
      env: { ...process.env, COOKIY_SERVER_URL: server.url },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
      if (mode === "success") child.stdout.destroy();
    });
    child.stderr.on("data", (data) => {
      stderr += data;
      if (mode === "failed") child.stderr.destroy();
    });
    const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
    expect(result).toEqual({ code: mode === "success" ? 0 : 1, signal: null });
    expect(mode === "success" ? stdout : stderr).not.toBe("");
    expect(mode === "success" ? stderr : stdout).toBe("");
    expect(stderr).not.toContain("EPIPE");
    expect(stderr).not.toContain("Unhandled");
  });
});
