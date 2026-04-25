import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist", "index.js");

function runCli(args: string[]): { stdout: string; stderr: string; code: number | null } {
  const res = spawnSync(process.execPath, [DIST, ...args], {
    encoding: "utf8",
    cwd: ROOT,
  });
  return { stdout: res.stdout, stderr: res.stderr, code: res.status };
}

beforeAll(() => {
  if (!existsSync(DIST)) {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  }
});

describe("CLI argument parsing — commander integration (subprocess)", () => {
  it("T14: unknown sub-command → commander error + helpAfterError", () => {
    const { stderr, code } = runCli(["no-such-command"]);

    expect(code).toBe(1);
    expect(stderr).toContain("error: unknown command 'no-such-command'");
    expect(stderr).toContain('(run "cookiy --help" for usage)');
  });

  it("T15: missing required option → commander error", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cookiy-t15-"));
    const tokenPath = join(tmp, "token.txt");
    writeFileSync(tokenPath, "fake-token");
    try {
      const { stderr, code } = runCli([
        "--token",
        tokenPath,
        "study",
        "create",
      ]);

      expect(code).toBe(1);
      expect(stderr).toContain(
        "error: required option '--query <s>' not specified",
      );
      expect(stderr).toContain('(run "cookiy --help" for usage)');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("T16 (CLI form): --limit non-integer → custom parser error", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cookiy-t16-"));
    const tokenPath = join(tmp, "token.txt");
    writeFileSync(tokenPath, "fake-token");
    try {
      const { stderr, code } = runCli([
        "--token",
        tokenPath,
        "study",
        "list",
        "--limit",
        "abc",
      ]);

      expect(code).toBe(1);
      expect(stderr).toContain("--limit requires an integer, got: abc");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
