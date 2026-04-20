import os from "node:os";
import path from "node:path";

export const VERSION = "1.21.2";
export const DEFAULT_SERVER_URL = "https://s-api.cookiy.ai";
export const API_RPC_TIMEOUT = parseInt(
  process.env.COOKIY_API_RPC_TIMEOUT || process.env.COOKIY_MCP_RPC_TIMEOUT || "600",
  10,
);
export const INIT_TIMEOUT = 120;

export interface Runtime {
  tokenPath: string;
  serverUrlOpt: string;
  apiUrlOpt: string;
  accessToken: string;
  apiEndpoint: string;
}

export const runtime: Runtime = {
  tokenPath:
    process.env.COOKIY_CREDENTIALS || path.join(os.homedir(), ".cookiy", "token.txt"),
  serverUrlOpt: "",
  apiUrlOpt: "",
  accessToken: "",
  apiEndpoint: "",
};

export function resolveServerBase(): string {
  return runtime.serverUrlOpt || process.env.COOKIY_SERVER_URL || DEFAULT_SERVER_URL;
}

export function resolveLoginUrl(): string {
  return `${resolveServerBase()}/oauth/cli/start`;
}

export function resolveApiEndpoint(): void {
  if (runtime.apiUrlOpt) {
    runtime.apiEndpoint = runtime.apiUrlOpt;
    return;
  }
  const envUrl = process.env.COOKIY_API_URL || process.env.COOKIY_MCP_URL || "";
  if (envUrl) {
    runtime.apiEndpoint = envUrl;
    return;
  }
  runtime.apiEndpoint = `${resolveServerBase().replace(/\/$/, "")}/mcp`;
}
