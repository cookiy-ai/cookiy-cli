import { runtime, resolveServerBase, API_RPC_TIMEOUT } from "./config.js";
import { die, dieNoAccess } from "./util.js";

export class V1RequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
    public readonly details?: string,
  ) {
    super(message);
    this.name = "V1RequestError";
  }
}

const MAX_BODY_LEN = 500;

function truncate(s: string): string {
  if (s.length <= MAX_BODY_LEN) return s;
  const dropped = s.length - MAX_BODY_LEN;
  return `${s.slice(0, MAX_BODY_LEN)}\n… (truncated, ${dropped} more chars)`;
}

function summarizeHtml(s: string): string | null {
  const title = s.match(/<title[^>]*>\s*([^<]+?)\s*<\/title>/i)?.[1];
  const h1 = s.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i)?.[1];
  const summary = (title ?? h1)?.trim();
  if (summary) return `(HTML body) ${summary}`;
  return `(HTML body, ${s.length} chars suppressed)`;
}

function formatBody(parsed: unknown, text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (parsed && typeof parsed === "object") {
    return truncate(JSON.stringify(parsed, null, 2));
  }
  if (/^\s*<(!doctype|html\b|head\b|body\b)/i.test(trimmed)) {
    return summarizeHtml(trimmed);
  }
  return truncate(trimmed);
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
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutSec * 1000);
  // const where = `${method} ${url}`;

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${runtime.accessToken}`,
    };
    if (opts?.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
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

    const bodyDisplay = formatBody(parsed, text);

    if (res.status === 401) {
      dieNoAccess(bodyDisplay ?? undefined);
    }

    if (res.status < 200 || res.status >= 300) {
      const serverMessage =
        parsed && typeof parsed === "object"
          ? (parsed as { message?: unknown }).message
          : undefined;
      const head = `[HTTP ${res.status}]`; // ` ${where}`
      const msg = serverMessage ? `${head} ${String(serverMessage)}` : head;
      throw new V1RequestError(res.status, msg, parsed, bodyDisplay ?? undefined);
    }

    return parsed;
  } catch (e: unknown) {
    clearTimeout(timeoutId);
    if (e instanceof V1RequestError) throw e;
    if (timedOut) {
      die(`[timeout ${timeoutSec}s]`); // ` ${where}`
    }
    const err = e as {
      message?: string;
      cause?: { code?: string; message?: string };
    };
    const reason =
      err.cause?.code ?? err.cause?.message ?? err.message ?? String(e);
    die(`[fetch error] ${reason}`); // ` ${where} —`
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
      if (e.details) console.error(e.details);
      process.exit(1);
    }
    console.error((e as Error).message ?? String(e));
    process.exit(1);
  }
}
