import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DIST = join(ROOT, "dist", "index.js");

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Spawns the built CLI as a subprocess and resolves with stdout/stderr/exit
 * code. Async (not spawnSync) on purpose: tests run a mock HTTP server in the
 * same Node process, and spawnSync would block the parent event loop, freezing
 * the mock server's accept() loop and making the CLI subprocess hang.
 */
export function runCli(
  args: string[],
  env?: Record<string, string>,
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DIST, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...(env ?? {}) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("exit", (code, signal) => {
      resolve({ stdout, stderr, code, signal });
    });
  });
}

export function ensureBuilt(): void {
  if (!existsSync(DIST)) {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  }
}

export function makeTmpDir(prefix = "cookiy-e2e-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function rmDir(p: string): void {
  rmSync(p, { recursive: true, force: true });
}

export interface MockServer {
  url: string;
  close: () => Promise<void>;
}

export async function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<MockServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Mock server failed to bind");
  }
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
