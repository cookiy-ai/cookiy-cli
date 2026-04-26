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

const AUTH_BANNER_LINE_1 = "Access denied — token is missing or expired.";
const LOGIN_URL = "https://s-api.cookiy.ai/oauth/cli/start";

beforeAll(() => {
  ensureBuilt();
});

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmDir(tmpDirs.pop()!);
});

function newTmpDir(): string {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

function tmpToken(content: string): string {
  const p = path.join(newTmpDir(), "token.txt");
  fs.writeFileSync(p, content);
  return p;
}

describe("E2E — Token file issues (T1–T3) [no network]", () => {
  it("T1: token file does not exist → auth banner, exit 1", async () => {
    const tokenPath = path.join(newTmpDir(), "no-such-token.txt");

    const { stdout, stderr, code } = await runCli([
      "--token",
      tokenPath,
      "billing",
      "balance",
    ]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr.trim()).toBe(`${AUTH_BANNER_LINE_1}\nSign in:  ${LOGIN_URL}`);
  });

  it("T2: token file is empty → auth banner, exit 1", async () => {
    const tokenPath = tmpToken("");

    const { stdout, stderr, code } = await runCli([
      "--token",
      tokenPath,
      "billing",
      "balance",
    ]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr.trim()).toBe(`${AUTH_BANNER_LINE_1}\nSign in:  ${LOGIN_URL}`);
  });

  it("T3: token file has only whitespace → auth banner, exit 1", async () => {
    const tokenPath = tmpToken("  \n\t\n  ");

    const { stdout, stderr, code } = await runCli([
      "--token",
      tokenPath,
      "billing",
      "balance",
    ]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr.trim()).toBe(`${AUTH_BANNER_LINE_1}\nSign in:  ${LOGIN_URL}`);
  });
});

describe("E2E — HTTP 401 from real s-api.cookiy.ai (T4–T5) [real network]", () => {
  // These tests hit the real production API with a fake token. The server
  // reliably returns 401 with error_code=UNAUTHORIZED, which exercises the
  // CLI's dieNoAccess() path. Network-dependent.

  it("T4: invalid token, billing balance → 401 path, exit 1", async () => {
    const tokenPath = tmpToken("fake-invalid-token-xyz");

    const { stderr, code } = await runCli([
      "--token",
      tokenPath,
      "billing",
      "balance",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain(AUTH_BANNER_LINE_1);
    expect(stderr).toContain(LOGIN_URL);
  });

  it("T5: invalid token, study list → 401 path, exit 1", async () => {
    const tokenPath = tmpToken("not.a.valid.jwt.here");

    const { stderr, code } = await runCli([
      "--token",
      tokenPath,
      "study",
      "list",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain(AUTH_BANNER_LINE_1);
    expect(stderr).toContain(LOGIN_URL);
  });
});

describe("E2E — HTTP 403 host-not-in-allowlist [mock — real API doesn't easily produce 403]", () => {
  let server: MockServer;

  beforeAll(async () => {
    server = await startMockServer((_req, res) => {
      res.statusCode = 403;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          status_code: 403,
          error_code: "FORBIDDEN",
          code: "FORBIDDEN",
          message: "host not in allowlist",
          data: "host not in allowlist",
        }),
      );
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("T_403: 403 → [HTTP 403] + body details, exit 1, no auth banner", async () => {
    const tokenPath = tmpToken("fake-token");

    const { stderr, code } = await runCli(
      ["--token", tokenPath, "billing", "balance"],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("[HTTP 403]");
    expect(stderr).toContain("host not in allowlist");
    // 403 must NOT trigger the auth-redirect banner — that is reserved for
    // missing/empty token files (T1–T3) and 401 server responses (T4–T5).
    expect(stderr).not.toContain(AUTH_BANNER_LINE_1);
  });
});

describe("E2E — Network-layer errors (T6–T8)", () => {
  it("T6: connection refused (port closed) → [fetch error] ECONNREFUSED [no mock]", async () => {
    // Bind a temporary listener to grab a free port, then close it so the
    // OS will refuse the next connect(). Pure OS-level behavior — the
    // listener exists only to find a port and is gone before we test.
    const probe = await startMockServer(() => undefined);
    const url = probe.url;
    await probe.close();

    const tokenPath = tmpToken("fake-token");

    const { stderr, code } = await runCli(
      ["--token", tokenPath, "billing", "balance"],
      { COOKIY_SERVER_URL: url },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("[fetch error]");
    expect(stderr).toContain("ECONNREFUSED");
  });

  it("T7: DNS resolution failure → [fetch error] ENOTFOUND [no mock]", async () => {
    // Real DNS lookup against the IETF-reserved .invalid TLD.
    const tokenPath = tmpToken("fake-token");

    const { stderr, code } = await runCli(
      ["--token", tokenPath, "billing", "balance"],
      {
        COOKIY_SERVER_URL: "http://this-host-does-not-exist-cookiy.invalid",
      },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("[fetch error]");
    expect(stderr).toContain("ENOTFOUND");
  });

  it("T8: timeout against a hanging server → [timeout 2s] [mock — real API responds fast]", async () => {
    // Mock server accepts the TCP connection but never writes a response,
    // forcing the client's AbortController timeout path. Cannot be driven
    // against the real API since it always responds quickly.
    const hanging = await startMockServer(() => {
      // intentionally do nothing — leave the request pending
    });
    try {
      const tokenPath = tmpToken("fake-token");

      const { stderr, code } = await runCli(
        ["--token", tokenPath, "billing", "balance"],
        {
          COOKIY_SERVER_URL: hanging.url,
          COOKIY_API_RPC_TIMEOUT: "2",
        },
      );

      expect(code).toBe(1);
      expect(stderr).toMatch(/^\[timeout 2s\]/m);
    } finally {
      await hanging.close();
    }
  }, 15_000);
});

describe("E2E — save-token (T9–T13) [no network]", () => {
  it("T9: empty argument → usage error, exit 1", async () => {
    const { stdout, stderr, code } = await runCli(["save-token", ""]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr.trim()).toBe(
      "Usage: cookiy save-token <access_token_or_json>",
    );
  });

  it("T10: JSON missing access_token field → error, exit 1", async () => {
    const { stdout, stderr, code } = await runCli([
      "save-token",
      '{"token":"abc","expires_in":3600}',
    ]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr.trim()).toBe("Could not find access_token in input.");
  });

  it("T11: raw token string is saved verbatim, exit 0", async () => {
    const tokenPath = path.join(newTmpDir(), "token.txt");

    const { stderr, code } = await runCli([
      "--token",
      tokenPath,
      "save-token",
      "my-raw-access-token-xyz",
    ]);

    expect(code).toBe(0);
    expect(stderr.trim()).toBe(`Token saved to ${tokenPath}`);
    expect(fs.readFileSync(tokenPath, "utf8")).toBe("my-raw-access-token-xyz");
  });

  it("T12: JSON with access_token field is extracted and saved, exit 0", async () => {
    const tokenPath = path.join(newTmpDir(), "token.txt");

    const { stderr, code } = await runCli([
      "--token",
      tokenPath,
      "save-token",
      '{"access_token":"my-json-access-token-abc","token_type":"Bearer","expires_in":3600}',
    ]);

    expect(code).toBe(0);
    expect(stderr.trim()).toBe(`Token saved to ${tokenPath}`);
    expect(fs.readFileSync(tokenPath, "utf8")).toBe("my-json-access-token-abc");
  });

  it("T13: write path with non-directory parent → [save-token] prefixed error", async () => {
    const blocker = path.join(newTmpDir(), "blocker");
    fs.writeFileSync(blocker, "blocker");
    const tokenPath = path.join(blocker, "sub", "token.txt");

    const { stderr, code } = await runCli([
      "--token",
      tokenPath,
      "save-token",
      "any-token",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain(`[save-token] failed to write ${tokenPath}`);
    expect(stderr).toContain("ENOTDIR");
  });
});

describe("E2E — CLI argument parsing (T14–T16) [no network]", () => {
  it("T14: unknown sub-command → commander error + helpAfterError", async () => {
    const { stderr, code } = await runCli(["no-such-command"]);

    expect(code).toBe(1);
    expect(stderr).toContain("error: unknown command 'no-such-command'");
    expect(stderr).toContain('(run "cookiy --help" for usage)');
  });

  it("T15: missing required option → commander error", async () => {
    const tokenPath = tmpToken("fake-token");

    const { stderr, code } = await runCli([
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
  });

  it("T16: --limit non-integer → custom parser error", async () => {
    const tokenPath = tmpToken("fake-token");

    const { stderr, code } = await runCli([
      "--token",
      tokenPath,
      "study",
      "list",
      "--limit",
      "abc",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("--limit requires an integer, got: abc");
  });
});
