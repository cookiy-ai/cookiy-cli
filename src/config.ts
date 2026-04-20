import os from "node:os";
import path from "node:path";

export const VERSION = "1.21.4";
export const DEFAULT_SERVER_URL = "https://s-api.cookiy.ai";
export const API_RPC_TIMEOUT = parseInt(
  process.env.COOKIY_API_RPC_TIMEOUT || "600",
  10,
);
export const INIT_TIMEOUT = 120;

export interface Runtime {
  tokenPath: string;
  accessToken: string;
  apiEndpoint: string;
}

export const runtime: Runtime = {
  tokenPath:
    process.env.COOKIY_CREDENTIALS || path.join(os.homedir(), ".cookiy", "token.txt"),
  accessToken: "",
  apiEndpoint: "",
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

export function resolveApiEndpoint(): void {
  runtime.apiEndpoint = `${resolveServerBase().replace(/\/$/, "")}/mcp`;
}
