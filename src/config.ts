import os from "node:os";
import path from "node:path";

// Injected at build time from package.json via tsup `define` — keeping
// the version number in a single source of truth.
declare const __COOKIY_VERSION__: string;
export const VERSION = __COOKIY_VERSION__;
export const DEFAULT_SERVER_URL = "https://s-api.cookiy.ai";
export const API_RPC_TIMEOUT = parseInt(
  process.env.COOKIY_API_RPC_TIMEOUT || "600",
  10,
);
export const INIT_TIMEOUT = 120;

export interface Runtime {
  tokenPath: string;
  accessToken: string;
}

export const runtime: Runtime = {
  tokenPath:
    process.env.COOKIY_CREDENTIALS || path.join(os.homedir(), ".cookiy", "token.txt"),
  accessToken: "",
};

export function resolveServerBase(): string {
  // COOKIY_SERVER_URL is an undocumented internal escape hatch — used by
  // the Cookiy team to point the CLI at dev/preview/staging environments.
  // Not exposed in --help.
  return process.env.COOKIY_SERVER_URL || DEFAULT_SERVER_URL;
}

export function resolveLoginUrl(): string {
  return `${resolveServerBase()}/oauth/cli/start`;
}
