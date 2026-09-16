import { resolveLoginUrl } from "./config.js";

export class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CliError";
  }
}

function writeFully(stream: NodeJS.WriteStream, text: string): Promise<void> {
  const output = text.endsWith("\n") ? text : `${text}\n`;

  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.write(output, (error) => {
      if (error) {
        reject(error);
        return;
      }
      stream.removeListener("error", reject);
      resolve();
    });
  });
}

export async function exitWithOutput(options: {
  code: number;
  stdout?: string;
  stderr?: string;
}): Promise<never> {
  try {
    if (options.stdout !== undefined) {
      await writeFully(process.stdout, options.stdout);
    }
    if (options.stderr !== undefined) {
      await writeFully(process.stderr, options.stderr);
    }
  } catch (error) {
    if (!process.stderr.destroyed) {
      try {
        await writeFully(process.stderr, `Failed to write output: ${error instanceof Error ? error.message : String(error)}`);
      } catch {
        // No usable error stream remains; communicate failure via the exit code.
      }
    }
    process.exit(options.code === 0 ? 1 : options.code);
  }
  process.exit(options.code);
}

// Synchronous input/authentication failures keep their small, immediate diagnostics.
export function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

export function dieNoAccess(_detail?: string): never {
  die(`Access denied — token is missing or expired.\nSign in:  ${resolveLoginUrl()}`);
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
