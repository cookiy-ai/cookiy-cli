import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ensureBuilt,
  makeTmpDir,
  rmDir,
  runCli,
  startMockServer,
  type MockServer,
} from "./helpers.js";

describe("E2E — ResearchPlan to Survey recruitment", () => {
  let server: MockServer;
  let tokenDir: string;
  let tokenPath: string;
  let responseStatus = 200;
  let responseBody: unknown = { ok: true, data: { preview: true } };
  let lastRequest:
    | { method?: string; url?: string; body: Record<string, unknown> }
    | undefined;

  beforeAll(async () => {
    ensureBuilt();
    tokenDir = makeTmpDir();
    tokenPath = path.join(tokenDir, "token.txt");
    fs.writeFileSync(tokenPath, "fake-token");
    server = await startMockServer((req, res) => {
      let rawBody = "";
      req.on("data", (chunk: Buffer) => {
        rawBody += chunk.toString("utf8");
      });
      req.on("end", () => {
        lastRequest = {
          method: req.method,
          url: req.url,
          body: rawBody ? JSON.parse(rawBody) : {},
        };
        res.statusCode = responseStatus;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(responseBody));
      });
    });
  });

  afterAll(async () => {
    await server.close();
    rmDir(tokenDir);
  });

  it("sends the Survey URL and quant mode when an existing study is converted", async () => {
    responseStatus = 200;
    responseBody = { ok: true, data: { preview: true } };

    const result = await runCli(
      [
        "--token",
        tokenPath,
        "recruit",
        "start",
        "--study-id",
        "00000000-0000-4000-8000-000000000001",
        "--survey-public-url",
        "https://ls.cookiy.ai/index.php/survey/index/sid/123456",
        "--plain-text",
        "Adults in Denmark",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(result.code).toBe(0);
    expect(lastRequest).toEqual({
      method: "POST",
      url:
        "/api/v1/studies/00000000-0000-4000-8000-000000000001/recruit/preview",
      body: {
        force_reconfigure: true,
        plain_text: "Adults in Denmark",
        recruit_mode: "quant_survey",
        survey_public_url:
          "https://ls.cookiy.ai/index.php/survey/index/sid/123456",
      },
    });
  });

  it("surfaces a nested service error message and code on the first stderr line", async () => {
    responseStatus = 409;
    responseBody = {
      ok: false,
      error: {
        code: "STUDY_STATE_INVALID_FOR_DELETE",
        message:
          "This ResearchPlan cannot be converted to a Survey in its current state.",
      },
    };

    const result = await runCli(
      [
        "--token",
        tokenPath,
        "recruit",
        "start",
        "--study-id",
        "00000000-0000-4000-8000-000000000001",
        "--survey-public-url",
        "https://ls.cookiy.ai/index.php/survey/index/sid/123456",
        "--plain-text",
        "Adults in Denmark",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(result.code).toBe(1);
    expect(result.stderr.split("\n")[0]).toBe(
      "[HTTP 409] This ResearchPlan cannot be converted to a Survey in its current state. (STUDY_STATE_INVALID_FOR_DELETE)",
    );
    expect(result.stderr).toContain('"ok": false');
  });
});
