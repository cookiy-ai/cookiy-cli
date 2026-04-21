import fs from "node:fs";
import path from "node:path";
import {
  runtime,
  resolveServerBase,
  resolveLoginUrl,
  INIT_TIMEOUT,
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

  const verifyUrl = `${resolveServerBase().replace(/\/$/, "")}/api/v1/billing/balance`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INIT_TIMEOUT * 1000);

  try {
    const res = await fetch(verifyUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${at}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const http = res.status;
    if (http === 401 || http === 403) {
      die(
        `Token verify failed (HTTP ${http}) — token is invalid or expired. Sign in again at: ${resolveLoginUrl()}`,
      );
    }
    if (http < 200 || http >= 300) {
      const body = await res.text().catch(() => "");
      die(
        `Token verify HTTP ${http} — unable to reach ${verifyUrl}${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
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
