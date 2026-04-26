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

describe("E2E — Token file issues (T1–T3)", () => {
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

describe("E2E — HTTP 401 from mock server (T4–T5)", () => {
  let server: MockServer;
  const requests: { method: string; url: string }[] = [];

  beforeAll(async () => {
    server = await startMockServer((req, res) => {
      requests.push({ method: req.method ?? "", url: req.url ?? "" });
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          status_code: 401,
          error_code: "UNAUTHORIZED",
          code: "UNAUTHORIZED",
          data: "invalid_api_key",
          message: "invalid_api_key",
        }),
      );
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("T4: invalid token, billing balance → 401 path, exit 1", async () => {
    const tokenPath = tmpToken("fake-invalid-token-xyz");
    const before = requests.length;

    const { stderr, code } = await runCli(
      ["--token", tokenPath, "billing", "balance"],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(1);
    expect(requests.length).toBe(before + 1);
    expect(requests[before].url).toBe("/api/v1/billing/balance");
    expect(stderr).toContain(AUTH_BANNER_LINE_1);
  });

  it("T5: invalid token, study list → 401 path, exit 1", async () => {
    const tokenPath = tmpToken("not.a.valid.jwt.here");
    const before = requests.length;

    const { stderr, code } = await runCli(
      ["--token", tokenPath, "study", "list"],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(1);
    expect(requests.length).toBe(before + 1);
    expect(requests[before].url.startsWith("/api/v1/stud")).toBe(true);
    expect(stderr).toContain(AUTH_BANNER_LINE_1);
  });
});

describe("E2E — Network-layer errors (T6–T8)", () => {
  it("T6: connection refused (port closed) → [fetch error] ECONNREFUSED", async () => {
    // Find a free port, then immediately close the listener so connect() will
    // be refused. Avoids privileged ports (some platforms reject ":1" as
    // "bad port" before issuing a SYN).
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

  it("T7: DNS resolution failure → [fetch error] ENOTFOUND", async () => {
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

  it("T8: timeout against a hanging server → [timeout 2s]", async () => {
    // Mock server accepts the TCP connection but never writes a response —
    // forces the client's AbortController timeout path.
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

describe("E2E — save-token (T9–T13)", () => {
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

describe("E2E — CLI argument parsing (T14–T16)", () => {
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
