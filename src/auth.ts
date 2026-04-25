import fs from "node:fs";
import path from "node:path";
import { runtime } from "./config.js";
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

  const dir = path.dirname(runtime.tokenPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(runtime.tokenPath, at, { mode: 0o600 });

  console.error(`Token saved to ${runtime.tokenPath}`);
}
