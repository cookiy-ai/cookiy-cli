import { runtime, resolveServerBase, resolveLoginUrl, API_RPC_TIMEOUT } from "./config.js";
import { exitWithOutput, CliError } from "./util.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveErrorLoginUrl(error: Record<string, unknown>): string {
  if (typeof error.login_url === "string") return error.login_url;
  if (
    isRecord(error.details) &&
    typeof error.details.login_url === "string"
  ) {
    return error.details.login_url;
  }
  return resolveLoginUrl();
}

// V1 reserves ok/data for its transport envelope, not business fields.
function unwrapSuccessResponse(value: unknown): unknown {
  return isRecord(value) && value.ok === true && Object.hasOwn(value, "data")
    ? value.data
    : value;
}

function extractApiError(value: unknown): unknown {
  return isRecord(value) && value.ok === false && Object.hasOwn(value, "error")
    ? value.error
    : undefined;
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
  },
): Promise<unknown> {
  const url = buildUrl(path, opts?.query);
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, API_RPC_TIMEOUT * 1000);

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

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (res.status < 200 || res.status >= 300) {
      const bodyDisplay = formatBody(parsed, text);
      const serverMessage =
        parsed && typeof parsed === "object"
          ? (parsed as { message?: unknown }).message
          : undefined;
      const head = `[HTTP ${res.status}]`;
      const msg = serverMessage ? `${head} ${String(serverMessage)}` : head;
      throw new V1RequestError(res.status, msg, parsed, bodyDisplay ?? undefined);
    }

    return unwrapSuccessResponse(parsed);
  } catch (e: unknown) {
    if (e instanceof V1RequestError) throw e;
    if (timedOut) {
      throw new CliError("REQUEST_TIMEOUT", `[timeout ${API_RPC_TIMEOUT}s]`);
    }
    const err = e as {
      message?: string;
      cause?: { code?: string; message?: string };
    };
    const reason =
      err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(e);
    throw new CliError("NETWORK_ERROR", `[fetch error] ${reason}`);
  } finally {
    clearTimeout(timeoutId);
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
): Promise<never> {
  try {
    const result = await fn();
    return exitWithOutput({
      code: 0,
      stdout:
        result === undefined
          ? undefined
          : typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2),
    });
  } catch (e: unknown) {
    let error: unknown;
    if (e instanceof V1RequestError) {
      error = extractApiError(e.body);
      if (error === undefined) {
        error = e.status === 401
          ? {
              code: "UNAUTHORIZED",
              message: "Access denied — token is missing or expired.",
            }
          : { code: `HTTP_${e.status}`, message: e.message, details: e.details };
      }
      if (e.status === 401 && isRecord(error)) {
        error = { ...error, login_url: resolveErrorLoginUrl(error) };
      }
    } else if (e instanceof CliError) {
      error = { code: e.code, message: e.message, details: e.details };
    } else {
      error = { code: "CLI_ERROR", message: e instanceof Error ? e.message : String(e) };
    }
    return exitWithOutput({
      code: 1,
      stderr: JSON.stringify(error, null, 2),
    });
  }
}
