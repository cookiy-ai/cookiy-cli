import { runtime, resolveServerBase, API_RPC_TIMEOUT } from "./config.js";
import { die, dieNoAccess, exitWithOutput } from "./util.js";

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

function normalizeSuccessResponse(value: unknown): unknown {
  const payload =
    isRecord(value) && value.ok === true && Object.hasOwn(value, "data")
      ? value.data
      : value;

  if (!isRecord(payload) || !Object.hasOwn(payload, "status_message")) {
    return payload;
  }

  const { status_message: _statusMessage, ...businessData } = payload;
  return businessData;
}

function formatInvalidParameters(details: unknown): string | undefined {
  if (!isRecord(details) || !Array.isArray(details.issues)) return undefined;

  const messages = details.issues.flatMap((issue) => {
    if (!isRecord(issue)) return [];
    const path = typeof issue.path === "string" ? issue.path : "";
    const message = typeof issue.message === "string" ? issue.message : "";
    if (!message) return [];
    return `${path ? `[${path}]: ` : ""}${message}`;
  });

  return messages.length > 0
    ? `Invalid parameters: ${messages.join("; ")}`
    : undefined;
}

function normalizeErrorResponse(value: unknown): unknown | undefined {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) {
    return undefined;
  }

  const error = value.error;
  const invalidParameters =
    error.code === "BAD_REQUEST" &&
    error.message === "The request body is invalid."
      ? formatInvalidParameters(error.details)
      : undefined;
  if (invalidParameters) {
    return {
      ok: false,
      data: null,
      error: { message: invalidParameters },
    };
  }

  if (error.code === "INSUFFICIENT_BALANCE" && isRecord(error.details)) {
    return {
      ok: false,
      data: null,
      error: {
        code: error.code,
        message: error.message,
        details: {
          workflow_state: "payment_required",
          total_cost_cents: error.details.total_cost_cents ?? null,
          shortfall_cents: error.details.shortfall_cents ?? null,
          quote: error.details.quote ?? null,
        },
      },
    };
  }

  return {
    ok: false,
    data: null,
    error,
  };
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
    clearTimeout(timeoutId);
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
      const head = `[HTTP ${res.status}]`;
      const msg = serverMessage ? `${head} ${String(serverMessage)}` : head;
      throw new V1RequestError(res.status, msg, parsed, bodyDisplay ?? undefined);
    }

    return normalizeSuccessResponse(parsed);
  } catch (e: unknown) {
    clearTimeout(timeoutId);
    if (e instanceof V1RequestError) throw e;
    if (timedOut) {
      die(`[timeout ${timeoutSec}s]`);
    }
    const err = e as {
      message?: string;
      cause?: { code?: string; message?: string };
    };
    const reason =
      err.cause?.code ?? err.cause?.message ?? err.message ?? String(e);
    die(`[fetch error] ${reason}`);
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
    await exitWithOutput({
      code: 0,
      stdout:
        result === undefined || result === null
          ? undefined
          : typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2),
    });
  } catch (e: unknown) {
    if (e instanceof V1RequestError) {
      const normalizedError = normalizeErrorResponse(e.body);
      if (normalizedError !== undefined) {
        await exitWithOutput({
          code: 1,
          stdout: JSON.stringify(normalizedError, null, 2),
        });
      }
      await exitWithOutput({
        code: 1,
        stderr: [e.message, e.details].filter(Boolean).join("\n"),
      });
    }
    await exitWithOutput({
      code: 1,
      stderr: (e as Error).message ?? String(e),
    });
  }
}
