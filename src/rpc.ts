import { runtime, API_RPC_TIMEOUT, INIT_TIMEOUT, VERSION } from "./config.js";
import { die, dieNoAccess } from "./util.js";

let rpcId = 0;
function nextId(): number {
  rpcId += 1;
  return rpcId;
}

export interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: {
    structuredContent?: {
      data?: unknown;
      ok?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  error?: {
    code?: string | number;
    message?: string;
    data?: unknown;
  };
  status_code?: number;
  [key: string]: unknown;
}

export async function postJsonRpc(
  payload: unknown,
  timeoutSec = API_RPC_TIMEOUT,
): Promise<JsonRpcResponse | string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSec * 1000);
  try {
    const res = await fetch(runtime.apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${runtime.accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const http = res.status;
    const body = await res.text();

    if (http === 401 || http === 403) dieNoAccess();
    if (http < 200 || http >= 300) {
      console.error(`HTTP ${http} — POST ${runtime.apiEndpoint}`);
      if (body.trim()) console.error(body.slice(0, 4000));
      return null;
    }

    try {
      return JSON.parse(body) as JsonRpcResponse;
    } catch {
      return body;
    }
  } catch (e: unknown) {
    clearTimeout(timeoutId);
    const err = e as { name?: string; message?: string };
    if (err.name === "AbortError") {
      console.error(`Request timeout (${timeoutSec}s)`);
    } else {
      console.error(`fetch: ${err.message ?? String(e)}`);
    }
    return null;
  }
}

export function checkAuthError(body: unknown): void {
  if (typeof body !== "object" || body === null) return;
  const b = body as JsonRpcResponse;
  if (b.status_code === 401 || b.status_code === 403) dieNoAccess();
  const code = b.error?.code;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "AUTH_REQUIRED") {
    dieNoAccess();
  }
}

export function checkRpcError(resp: unknown): boolean {
  if (!resp || typeof resp !== "object") return false;
  const r = resp as JsonRpcResponse;
  const msg = r.error?.message;
  if (msg) {
    const data = r.error?.data;
    if (data !== undefined && data !== null) {
      console.error(
        `${msg}: ${typeof data === "string" ? data : JSON.stringify(data)}`,
      );
    } else {
      console.error(msg);
    }
    return true;
  }
  return false;
}

export function emitToolResult(resp: unknown): unknown {
  if (!resp || typeof resp !== "object") return null;
  const r = (resp as JsonRpcResponse).result;
  if (!r) return null;
  const sc = r.structuredContent;
  if (sc && "data" in sc) return sc.data;
  if (sc && sc.ok === false) return sc;
  return null;
}

let _initialized = false;

async function ensureInitialized(): Promise<void> {
  if (_initialized) return;
  const initResp = await postJsonRpc(
    {
      jsonrpc: "2.0",
      id: nextId(),
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "cookiy-cli", version: VERSION },
      },
    },
    INIT_TIMEOUT,
  );
  if (!initResp) die("API initialize request failed");
  checkAuthError(initResp);
  if (checkRpcError(initResp)) die("API initialize error");

  await postJsonRpc(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    INIT_TIMEOUT,
  ).catch(() => {});

  _initialized = true;
}

export async function callTool(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  await ensureInitialized();
  const callResp = await postJsonRpc({
    jsonrpc: "2.0",
    id: nextId(),
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });
  if (!callResp) die("API tools/call request failed");
  checkAuthError(callResp);
  if (checkRpcError(callResp)) process.exit(1);
  const printable = emitToolResult(callResp);
  checkAuthError(printable);
  return printable;
}

export async function invoke(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<boolean> {
  const printable = await callTool(toolName, args);
  if (printable !== null && printable !== undefined) {
    console.log(
      typeof printable === "string" ? printable : JSON.stringify(printable, null, 2),
    );
  }
  if (
    printable &&
    typeof printable === "object" &&
    (printable as { ok?: unknown }).ok === false
  ) {
    return false;
  }
  return true;
}
