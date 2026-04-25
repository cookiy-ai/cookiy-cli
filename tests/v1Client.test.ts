import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtime } from "../src/config.js";
import { v1, V1RequestError } from "../src/v1Client.js";
import { setupHarness, expectExit, type TestHarness } from "./helpers.js";

const AUTH_BANNER =
  "Access denied — token is missing or expired.\nSign in:  https://s-api.cookiy.ai/oauth/cli/start";

let harness: TestHarness;

beforeEach(() => {
  harness = setupHarness();
  runtime.accessToken = "fake-token";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockFetchResponse(status: number, body: unknown): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status,
      text: async () => text,
    })),
  );
}

function mockFetchError(cause: { code?: string; message?: string }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const err = new TypeError("fetch failed") as Error & { cause?: unknown };
      err.cause = cause;
      throw err;
    }),
  );
}

describe("v1Client — HTTP 401 (real-server fake-token shape)", () => {
  const body401 = {
    ok: false,
    status_code: 401,
    error_code: "UNAUTHORIZED",
    code: "UNAUTHORIZED",
    data: "invalid_api_key",
    message: "invalid_api_key",
  };

  it("T4: GET /billing/balance returns 401 → dieNoAccess (auth banner only)", async () => {
    mockFetchResponse(401, body401);

    const code = await expectExit(() => v1.get("/v1/billing/balance"));

    expect(code).toBe(1);
    // Current behavior: dieNoAccess fires, only banner printed (detail suppressed).
    expect(harness.stderr()).toBe(AUTH_BANNER);
  });

  it("T5: GET /study returns 401 → dieNoAccess", async () => {
    mockFetchResponse(401, body401);

    const code = await expectExit(() => v1.get("/v1/study"));

    expect(code).toBe(1);
    expect(harness.stderr()).toBe(AUTH_BANNER);
  });
});

describe("v1Client — network-layer errors", () => {
  it("T6: fetch fails with ECONNREFUSED → [fetch error] ECONNREFUSED", async () => {
    mockFetchError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" });

    const code = await expectExit(() => v1.get("/v1/billing/balance"));

    expect(code).toBe(1);
    expect(harness.stderr()).toBe("[fetch error] ECONNREFUSED");
  });

  it("T7: fetch fails with ENOTFOUND → [fetch error] ENOTFOUND", async () => {
    mockFetchError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" });

    const code = await expectExit(() => v1.get("/v1/billing/balance"));

    expect(code).toBe(1);
    expect(harness.stderr()).toBe("[fetch error] ENOTFOUND");
  });

  it("T8a: fetch fails with ECONNREFUSED (sandbox-style) → [fetch error] ECONNREFUSED", async () => {
    mockFetchError({ code: "ECONNREFUSED" });

    const code = await expectExit(() => v1.get("/v1/billing/balance"));

    expect(code).toBe(1);
    expect(harness.stderr()).toBe("[fetch error] ECONNREFUSED");
  });

  it("T8b: AbortError from timeout → [timeout Ns]", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, opts?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener("abort", () => {
              const err = new Error("This operation was aborted") as Error & {
                name: string;
              };
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );

    const settled = expectExit(() => v1.get("/v1/billing/balance"));
    // Default API_RPC_TIMEOUT is 600s. Advance well past it.
    await vi.advanceTimersByTimeAsync(700_000);
    const code = await settled;

    expect(code).toBe(1);
    expect(harness.stderr()).toMatch(/^\[timeout \d+s\]$/);
    vi.useRealTimers();
  });
});

describe("v1Client — V1RequestError shape (sanity)", () => {
  it("non-401 4xx surfaces as V1RequestError with [HTTP NNN]", async () => {
    mockFetchResponse(500, { message: "boom" });

    await expect(() => v1.get("/v1/billing/balance")).rejects.toThrow(
      V1RequestError,
    );
  });
});
