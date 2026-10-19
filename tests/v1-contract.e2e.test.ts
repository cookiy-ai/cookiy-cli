import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

const LARGE_OUTPUT = "x".repeat(1_000_000);

beforeAll(() => {
  ensureBuilt();
});

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmDir(tmpDirs.pop()!);
});

function tmpToken(content: string): string {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  const tokenPath = path.join(dir, "token.txt");
  fs.writeFileSync(tokenPath, content);
  return tokenPath;
}

describe("REST response compatibility", () => {
  let server: MockServer;

  beforeAll(async () => {
    server = await startMockServer((req, res) => {
      res.setHeader("content-type", "application/json");

      if (req.url === "/api/v1/user/info") {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: true,
            data: { limitations: ["Current limitation"] },
          }),
        );
        return;
      }

      if (req.url === "/api/v1/billing/cash-credit/checkout") {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            ok: false,
            error: {
              code: "BAD_REQUEST",
              message: "The request body is invalid.",
              details: {
                issues: [
                  {
                    path: "amount_cents",
                    message: "Too small: expected number to be >=1000",
                  },
                ],
              },
            },
          }),
        );
        return;
      }

      if (req.url === "/api/v1/studies/study-1/fake-interview") {
        res.statusCode = 402;
        res.end(
          JSON.stringify({
            ok: false,
            error: {
              code: "INSUFFICIENT_BALANCE",
              message: "Insufficient balance for synthetic interview",
              details: {
                feature: "synthetic",
                balance_cents: 0,
                total_cost_cents: 20,
                shortfall_cents: 20,
                quote: { required_personas: 1 },
                checkout_url: null,
              },
            },
          }),
        );
        return;
      }

      if (req.url === "/api/v1/studies/study-1/recruit/preview") {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              status: "confirmation_required",
              confirmation_token: "confirmation-token",
            },
          }),
        );
        return;
      }

      if (req.url === "/api/v1/studies/study-large/discussion-guide") {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              revision: "revision-large",
              discussion_guide: {
                long_text: LARGE_OUTPUT,
                tail_marker: "response-complete",
              },
            },
          }),
        );
        return;
      }

      if (req.url === "/api/v1/studies/study-null/discussion-guide") {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, data: null }));
        return;
      }

      if (req.url === "/api/v1/studies/study-empty/discussion-guide") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.url === "/api/v1/studies/study-body-timeout/discussion-guide") {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"partial":');
        // Keep the body pending; the client timeout must abort it.
        return;
      }

      if (req.url === "/api/v1/quant/surveys/survey-empty/raw-responses?only_completed=true") {
        res.end(JSON.stringify({ ok: true, data: { csv: "" } }));
        return;
      }

      if (req.url === "/api/v1/quant/surveys/survey-large/raw-responses?only_completed=true") {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, data: { csv: `answer,notes\n1,"${LARGE_OUTPUT}"\n2,response-complete` } }));
        return;
      }

      if (req.url === "/api/v1/quant/surveys/survey-json-looking/raw-responses?only_completed=true") {
        res.end(JSON.stringify({ ok: true, data: { csv: '"foo"' } }));
        return;
      }

      if (req.url === "/api/v1/quant/surveys/survey-all/raw-responses?only_completed=false") {
        res.end(JSON.stringify({ ok: true, data: { csv: "answer\ncomplete\nincomplete" } }));
        return;
      }

      if (req.url === "/api/v1/quant/surveys/survey-missing-csv/raw-responses?only_completed=true") {
        res.end(JSON.stringify({ ok: true, data: { row_count: 0 } }));
        return;
      }

      if (req.url === "/api/v1/quant/surveys/survey-invalid-csv/raw-responses?only_completed=true") {
        res.end(JSON.stringify({ ok: true, data: { csv: 42 } }));
        return;
      }

      if (req.url === "/api/v1/quant/surveys/survey-error/raw-responses?only_completed=true") {
        res.statusCode = 402;
        res.end(JSON.stringify({ ok: false, error: { code: "INSUFFICIENT_BALANCE", message: "Not enough balance" } }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: { message: "Not found" } }));
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("unwraps successful REST envelopes", async () => {
    const tokenPath = tmpToken("fake-token");
    const { stdout, stderr, code } = await runCli(
      ["--token", tokenPath, "user", "info"],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      limitations: ["Current limitation"],
    });
  });

  it("writes explicit null response data as JSON", async () => {
    const tokenPath = tmpToken("fake-token");
    const { stdout, stderr, code } = await runCli(
      [
        "--token",
        tokenPath,
        "study",
        "guide",
        "get",
        "--study-id",
        "study-null",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(0);
    expect(stdout).toBe("null\n");
    expect(stderr).toBe("");
  });

  it("does not write output for an empty response body", async () => {
    const tokenPath = tmpToken("fake-token");
    const { stdout, stderr, code } = await runCli(
      [
        "--token",
        tokenPath,
        "study",
        "guide",
        "get",
        "--study-id",
        "study-empty",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  it("writes REST validation error details to stderr", async () => {
    const tokenPath = tmpToken("fake-token");
    const { stdout, stderr, code } = await runCli(
      [
        "--token",
        tokenPath,
        "billing",
        "checkout",
        "--amount-usd-cents",
        "100",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toEqual({
      code: "BAD_REQUEST",
      message: "The request body is invalid.",
      http_status: 400,
      details: {
        issues: [
          {
            path: "amount_cents",
            message: "Too small: expected number to be >=1000",
          },
        ],
      },
    });
  });

  it("writes insufficient-balance error details to stderr", async () => {
    const tokenPath = tmpToken("fake-token");
    const { stdout, stderr, code } = await runCli(
      [
        "--token",
        tokenPath,
        "study",
        "run-synthetic-user",
        "start",
        "--study-id",
        "study-1",
        "--persona-count",
        "1",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toEqual({
      code: "INSUFFICIENT_BALANCE",
      message: "Insufficient balance for synthetic interview",
      http_status: 402,
      details: {
        feature: "synthetic",
        balance_cents: 0,
        total_cost_cents: 20,
        shortfall_cents: 20,
        quote: { required_personas: 1 },
        checkout_url: null,
      },
    });
  });

  it("preserves all REST business fields", async () => {
    const tokenPath = tmpToken("fake-token");
    const { stdout, stderr, code } = await runCli(
      [
        "--token",
        tokenPath,
        "recruit",
        "start",
        "--study-id",
        "study-1",
        "--plain-text",
        "Coffee consumers",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      status: "confirmation_required",
      confirmation_token: "confirmation-token",
    });
  });

  it("writes successful JSON responses larger than the stdout pipe buffer", async () => {
    const tokenPath = tmpToken("fake-token");
    const { stdout, stderr, code } = await runCli(
      [
        "--token",
        tokenPath,
        "study",
        "guide",
        "get",
        "--study-id",
        "study-large",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.length).toBeGreaterThan(1_000_000);
    expect(JSON.parse(stdout)).toEqual({
      revision: "revision-large",
      discussion_guide: {
        long_text: LARGE_OUTPUT,
        tail_marker: "response-complete",
      },
    });
  });

  it("prints complete raw CSV larger than the stdout pipe buffer", async () => {
    const tokenPath = tmpToken("fake-token");
    const expectedCsv = `answer,notes\n1,"${LARGE_OUTPUT}"\n2,response-complete`;
    const { stdout, stderr, code } = await runCli(
      [
        "--token",
        tokenPath,
        "quant",
        "raw-response",
        "--survey-id",
        "survey-large",
      ],
      { COOKIY_SERVER_URL: server.url },
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(`${expectedCsv}\n`);
  });

  it("prints empty CSV as text rather than a JSON object", async () => {
    const { stdout, stderr, code } = await runCli(
      ["--token", tmpToken("fake-token"), "quant", "raw-response", "--survey-id", "survey-empty"],
      { COOKIY_SERVER_URL: server.url },
    );
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe("\n");
  });

  it("does not parse JSON-looking CSV content", async () => {
    const { stdout, stderr, code } = await runCli(
      ["--token", tmpToken("fake-token"), "quant", "raw-response", "--survey-id", "survey-json-looking"],
      { COOKIY_SERVER_URL: server.url },
    );
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe('"foo"\n');
  });

  it("passes only_completed=false with include-incomplete", async () => {
    const { stdout, stderr, code } = await runCli(
      ["--token", tmpToken("fake-token"), "quant", "raw-response", "--survey-id", "survey-all", "--include-incomplete"],
      { COOKIY_SERVER_URL: server.url },
    );
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe("answer\ncomplete\nincomplete\n");
  });

  it.each(["survey-missing-csv", "survey-invalid-csv"])("fails when %s does not return a CSV string", async (surveyId) => {
    const { stdout, stderr, code } = await runCli(
      ["--token", tmpToken("fake-token"), "quant", "raw-response", "--survey-id", surveyId],
      { COOKIY_SERVER_URL: server.url },
    );
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toEqual({ code: "INVALID_RESPONSE", message: "Quant raw-response must contain a string csv field." });
  });

  it("keeps JSON errors when exporting CSV", async () => {
    const { stdout, stderr, code } = await runCli(
      ["--token", tmpToken("fake-token"), "quant", "raw-response", "--survey-id", "survey-error"],
      { COOKIY_SERVER_URL: server.url },
    );
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toEqual({ code: "INSUFFICIENT_BALANCE", message: "Not enough balance", http_status: 402 });
  });

  it("keeps the timeout active while reading the response body", async () => {
    const tokenPath = tmpToken("fake-token");
    const { stdout, stderr, code } = await runCli(
      [
        "--token",
        tokenPath,
        "study",
        "guide",
        "get",
        "--study-id",
        "study-body-timeout",
      ],
      {
        COOKIY_SERVER_URL: server.url,
        COOKIY_API_RPC_TIMEOUT: "1",
      },
    );

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toEqual({ code: "REQUEST_TIMEOUT", message: "[timeout 1s]" });
  });
});
