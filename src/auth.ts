import fs from "node:fs";
import path from "node:path";
import {
  runtime,
  resolveServerBase,
  resolveLoginUrl,
  INIT_TIMEOUT,
  VERSION,
} from "./config.js";
import { die, dieNoAccess } from "./util.js";

export function loadCredentials(): void {
  if (!fs.existsSync(runtime.tokenPath)) dieNoAccess();
  runtime.accessToken = fs
    .readFileSync(runtime.tokenPath, "utf8")
    .replace(/\r?\n/g, "")
    .trim();
  if (!runtime.accessToken) dieNoAccess();
}

export async function runSaveToken(input: string): Promise<void> {
  const raw = input.trim();
  if (!raw) die("Usage: cookiy save-token <access_token_or_json>");

  let at = "";
  try {
    const parsed = JSON.parse(raw) as { access_token?: string };
    if (parsed.access_token) at = parsed.access_token;
  } catch {
    at = raw;
  }
  if (!at) die("Could not find access_token in input.");

  let apiEnd =
    runtime.apiUrlOpt || process.env.COOKIY_API_URL || process.env.COOKIY_MCP_URL || "";
  if (!apiEnd) {
    apiEnd = `${resolveServerBase().replace(/\/$/, "")}/mcp`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INIT_TIMEOUT * 1000);

  try {
    const res = await fetch(apiEnd, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${at}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "cookiy-cli", version: VERSION },
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const http = res.status;
    const body = await res.text();

    if (http !== 200) {
      die(
        `Token verify HTTP ${http} — token may be invalid or expired. Sign in again at: ${resolveLoginUrl()}`,
      );
    }

    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (parsed.error) {
        die(`Token verify error: ${JSON.stringify(parsed.error)}`);
      }
    } catch {
      // body not JSON — still counted as success if HTTP 200
    }
  } catch (e: unknown) {
    clearTimeout(timeoutId);
    const err = e as { name?: string; message?: string };
    if (err.name === "AbortError") {
      die(`Token verify failed (timeout). Check your network and try again.`);
    }
    die(`Token verify failed (${err.message ?? String(e)}). Check your network and try again.`);
  }

  const dir = path.dirname(runtime.tokenPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(runtime.tokenPath, at, { mode: 0o600 });

  console.error(`Token verified and saved to ${runtime.tokenPath}`);
}
