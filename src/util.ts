import { resolveLoginUrl } from "./config.js";

export function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

export function dieNoAccess(detail?: string): never {
  const head = `Access denied — token is missing or expired.\nSign in:  ${resolveLoginUrl()}`;
  die(detail ? `${head}\n${detail}` : head);
}

export function parseBool(val: string): boolean {
  const v = val.toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  die(`Invalid boolean value: ${val} (use true or false)`);
}

export function parseIntOption(name: string) {
  return (val: string): number => {
    if (!/^-?\d+$/.test(val)) die(`--${name} requires an integer, got: ${val}`);
    return parseInt(val, 10);
  };
}

export function parseJsonArrayOption(name: string) {
  return (val: string): unknown[] => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(val);
    } catch {
      die(`--${name} requires a JSON array, got: ${val}`);
    }
    if (!Array.isArray(parsed)) die(`--${name} requires a JSON array, got: ${val}`);
    return parsed;
  };
}

export function parseJsonObjectOption(name: string) {
  return (val: string): Record<string, unknown> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(val);
    } catch {
      die(`--${name} requires a JSON object, got: ${val}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      die(`--${name} requires a JSON object, got: ${val}`);
    }
    return parsed as Record<string, unknown>;
  };
}

export function mergeRawJson(
  payload: Record<string, unknown>,
  rawJson: string | undefined,
  name = "json",
): Record<string, unknown> {
  if (!rawJson) return payload;
  try {
    const extra = JSON.parse(rawJson);
    if (typeof extra !== "object" || extra === null || Array.isArray(extra)) {
      die(`--${name} requires a JSON object`);
    }
    return { ...payload, ...(extra as Record<string, unknown>) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    die(`Invalid --${name} value: ${msg}`);
  }
}
