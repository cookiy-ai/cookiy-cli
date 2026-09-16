import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ensureBuilt, makeTmpDir, rmDir, runCli, startMockServer, type MockServer } from "./helpers.js";

describe("V1 runtime errors use JSON stderr", () => {
  let server: MockServer;
  let dir: string;
  let token: string;
  const apiError = { code: "UNAUTHORIZED", message: "Invalid token", details: { reason: "expired" } };

  beforeAll(async () => {
    ensureBuilt();
    dir = makeTmpDir();
    token = path.join(dir, "token.txt");
    fs.writeFileSync(token, "fake-token");
    server = await startMockServer((req, res) => {
      const studyId = req.url?.split("/")[4];
      if (studyId === "disconnect") {
        req.socket.destroy();
        return;
      }
      if (studyId === "timeout") return;
      if (studyId === "body-timeout") {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"ok":true,"data":');
        return;
      }
      if (studyId === "unauthorized" || studyId === "api-error") {
        res.statusCode = 401;
        res.end(studyId === "api-error" ? JSON.stringify({ ok: false, error: apiError }) : "Unauthorized");
        return;
      }
      if (studyId === "forbidden") {
        res.statusCode = 403;
        res.end(JSON.stringify({ ok: false, error: apiError }));
        return;
      }
      if (studyId?.startsWith("auth-details-")) {
        const details = JSON.parse(decodeURIComponent(studyId.slice("auth-details-".length)));
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error: { code: "TOKEN_EXPIRED", message: "Please sign in again", ...details } }));
        return;
      }
      res.statusCode = 500;
      if (studyId === "html") res.end("<!doctype html><html><title>Upstream unavailable</title></html>");
      else res.end("upstream unavailable");
    });
  });

  afterAll(async () => {
    await server.close();
    rmDir(dir);
  });

  it.each([
    ["plain", "HTTP_500"],
    ["html", "HTTP_500"],
    ["unauthorized", "UNAUTHORIZED"],
    ["api-error", "UNAUTHORIZED"],
    ["forbidden", "UNAUTHORIZED"],
    ["disconnect", "NETWORK_ERROR"],
    ["timeout", "REQUEST_TIMEOUT"],
    ["body-timeout", "REQUEST_TIMEOUT"],
    ["invalid-url", "CLI_ERROR"],
  ])("%s produces one JSON error and empty stdout", async (mode, errorCode) => {
    const { stdout, stderr, code } = await runCli(
      ["--token", token, "study", "guide", "get", "--study-id", mode],
      { COOKIY_SERVER_URL: mode === "invalid-url" ? "http://[" : server.url, COOKIY_API_RPC_TIMEOUT: "1" },
    );
    expect(code).toBe(1);
    expect(stdout).toBe("");
    const error = JSON.parse(stderr);
    expect(error.code).toBe(errorCode);
    expect(error.message).toEqual(expect.any(String));
    if (mode === "plain") expect(error.details).toBe("upstream unavailable");
    if (mode === "html") expect(error.details).toBe("(HTML body) Upstream unavailable");
    if (mode === "unauthorized") expect(error.details).toEqual({ login_url: `${server.url}/oauth/cli/start` });
    if (mode === "api-error") expect(error).toEqual({
      ...apiError,
      details: { ...apiError.details, login_url: `${server.url}/oauth/cli/start` },
    });
    if (mode === "forbidden") expect(error).toEqual(apiError);
    if (mode === "disconnect") expect(error.message).toContain("UND_ERR_SOCKET");
    if (mode === "invalid-url") expect(error.message).toBe("Invalid URL");
    if (mode.endsWith("timeout")) expect(error.message).toBe("[timeout 1s]");
  });

  it.each([
    [{}, {}],
    [{ details: { login_url: "https://old.example.com/login", reason: "expired" } }, { reason: "expired" }],
    [{ details: null }, { server_details: null }],
    [{ details: "expired" }, { server_details: "expired" }],
    [{ details: ["expired"] }, { server_details: ["expired"] }],
  ])("401 preserves server details and adds the configured login URL: %j", async (fields, preservedDetails) => {
    const { stdout, stderr, code } = await runCli(
      ["--token", token, "study", "guide", "get", "--study-id", `auth-details-${JSON.stringify(fields)}`],
      { COOKIY_SERVER_URL: server.url },
    );
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toEqual({
      code: "TOKEN_EXPIRED",
      message: "Please sign in again",
      details: { ...preservedDetails, login_url: `${server.url}/oauth/cli/start` },
    });
  });
});
