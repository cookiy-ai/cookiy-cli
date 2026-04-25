import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runtime } from "../src/config.js";
import { loadCredentials, runSaveToken } from "../src/auth.js";
import { setupHarness, expectExit, type TestHarness } from "./helpers.js";

const AUTH_BANNER =
  "Access denied — token is missing or expired.\nSign in:  https://s-api.cookiy.ai/oauth/cli/start";

let harness: TestHarness;
let tmpDir: string;

beforeEach(() => {
  harness = setupHarness();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cookiy-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadCredentials — token file issues", () => {
  it("T1: token file does not exist → dieNoAccess", async () => {
    runtime.tokenPath = path.join(tmpDir, "no-such-token.txt");

    const code = await expectExit(() => loadCredentials());

    expect(code).toBe(1);
    expect(harness.stderr()).toBe(AUTH_BANNER);
  });

  it("T2: token file is empty → dieNoAccess", async () => {
    runtime.tokenPath = path.join(tmpDir, "empty.txt");
    fs.writeFileSync(runtime.tokenPath, "");

    const code = await expectExit(() => loadCredentials());

    expect(code).toBe(1);
    expect(harness.stderr()).toBe(AUTH_BANNER);
  });

  it("T3: token file is whitespace-only → dieNoAccess", async () => {
    runtime.tokenPath = path.join(tmpDir, "ws.txt");
    fs.writeFileSync(runtime.tokenPath, "  \n\t\n  ");

    const code = await expectExit(() => loadCredentials());

    expect(code).toBe(1);
    expect(harness.stderr()).toBe(AUTH_BANNER);
  });
});

describe("runSaveToken", () => {
  it("T9: empty input → usage error", async () => {
    const code = await expectExit(() => runSaveToken(""));

    expect(code).toBe(1);
    expect(harness.stderr()).toBe(
      "Usage: cookiy save-token <access_token_or_json>",
    );
  });

  it("T10: JSON without access_token field → error", async () => {
    const code = await expectExit(() =>
      runSaveToken('{"token":"abc","expires_in":3600}'),
    );

    expect(code).toBe(1);
    expect(harness.stderr()).toBe("Could not find access_token in input.");
  });

  it("T11: raw token string is saved verbatim", async () => {
    runtime.tokenPath = path.join(tmpDir, "t11.txt");

    await runSaveToken("my-raw-access-token-xyz");

    expect(fs.readFileSync(runtime.tokenPath, "utf8")).toBe(
      "my-raw-access-token-xyz",
    );
    expect(harness.stderr()).toBe(`Token saved to ${runtime.tokenPath}`);
    expect(harness.exitSpy).not.toHaveBeenCalled();
  });

  it("T12: JSON with access_token field is extracted and saved", async () => {
    runtime.tokenPath = path.join(tmpDir, "t12.txt");

    await runSaveToken(
      '{"access_token":"my-json-access-token-abc","token_type":"Bearer","expires_in":3600}',
    );

    expect(fs.readFileSync(runtime.tokenPath, "utf8")).toBe(
      "my-json-access-token-abc",
    );
    expect(harness.stderr()).toBe(`Token saved to ${runtime.tokenPath}`);
  });

  it("T13: write path with non-directory parent → save-token prefixed error", async () => {
    const blocker = path.join(tmpDir, "blocker");
    fs.writeFileSync(blocker, "blocker");
    runtime.tokenPath = path.join(blocker, "sub", "token.txt");

    const code = await expectExit(() => runSaveToken("any-token"));

    expect(code).toBe(1);
    expect(harness.stderr()).toMatch(
      new RegExp(
        `^\\[save-token\\] failed to write ${runtime.tokenPath.replace(/\//g, "\\/")}: ENOTDIR`,
      ),
    );
  });
});
