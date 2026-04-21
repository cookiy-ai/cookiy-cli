import { runtime, resolveServerBase, API_RPC_TIMEOUT } from "./config.js";
import { die, dieNoAccess } from "./util.js";

export class V1RequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "V1RequestError";
  }
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
  const base = resolveServerBase().replace(/\/$/, "");
  const rel = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}/api${rel}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts?: {
    query?: Record<string, unknown>;
    body?: unknown;
    timeoutSec?: number;
  },
): Promise<unknown> {
  const url = buildUrl(path, opts?.query);
  const timeoutSec = opts?.timeoutSec ?? API_RPC_TIMEOUT;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSec * 1000);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${runtime.accessToken}`,
      },
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await res.text();
    let parsed: unknown = null;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (res.status === 401 || res.status === 403) dieNoAccess();

    if (res.status < 200 || res.status >= 300) {
      const msg =
        (parsed && typeof parsed === "object" &&
          (parsed as { message?: unknown }).message)
          ? String((parsed as { message?: unknown }).message)
          : `HTTP ${res.status}`;
      throw new V1RequestError(res.status, msg, parsed);
    }

    return parsed;
  } catch (e: unknown) {
    clearTimeout(timeoutId);
    if (e instanceof V1RequestError) throw e;
    const err = e as { name?: string; message?: string };
    if (err.name === "AbortError") {
      die(`Request timeout (${timeoutSec}s)`);
    }
    die(`fetch: ${err.message ?? String(e)}`);
  }
}

export const v1 = {
  get: (path: string, query?: Record<string, unknown>) =>
    request("GET", path, { query }),
  post: (path: string, body?: unknown) => request("POST", path, { body }),
  patch: (path: string, body?: unknown) => request("PATCH", path, { body }),
  delete: (path: string) => request("DELETE", path),
};

export async function runV1(
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await fn();
    if (result !== undefined && result !== null) {
      console.log(
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    }
    process.exit(0);
  } catch (e: unknown) {
    if (e instanceof V1RequestError) {
      console.error(e.message);
      if (e.body && typeof e.body === "object") {
        const detail = (e.body as { data?: unknown }).data;
        if (detail) {
          console.error(
            typeof detail === "string" ? detail : JSON.stringify(detail, null, 2),
          );
        }
      }
      process.exit(1);
    }
    console.error((e as Error).message ?? String(e));
    process.exit(1);
  }
}
