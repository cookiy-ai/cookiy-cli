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

beforeAll(() => {
  ensureBuilt();
});

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmDir(tmpDirs.pop()!);
});

function tmpToken(): string {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  const tokenPath = path.join(dir, "token.txt");
  fs.writeFileSync(tokenPath, "fake-token");
  return tokenPath;
}

describe("study guide update", () => {
  let server: MockServer;
  const requests: { method?: string; url?: string; body: unknown }[] = [];

  beforeAll(async () => {
    server = await startMockServer((req, res) => {

      let rawBody = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        rawBody += chunk;
      });
      req.on("end", () => {
        requests.push({ method: req.method, url: req.url, body: JSON.parse(rawBody) });
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            study_id: "study-1",
            revision: "revision-next",
            base_revision: "revision-base",
            idempotency_key: "request-key",
            applied: true,
          }),
        );
      });
    });
  });

  afterAll(async () => {
    await server.close();
  });

  function runGuideUpdate(patch: Record<string, unknown>) {
    return runCli(
      [
        "--token",
        tmpToken(),
        "study",
        "guide",
        "update",
        "--study-id",
        "study-1",
        "--base-revision",
        "revision-base",
        "--idempotency-key",
        "request-key",
        "--json",
        JSON.stringify(patch),
      ],
      { COOKIY_SERVER_URL: server.url },
    );
  }

  it.each([
    { meta: { sample_size: 8, interview_duration: 15 } },
    { questions: [{ text: "Who?", sub_questions: [] }], extra: {}, note: null },
    { "question.text": "literal key", "questions.0.text": "also literal" },
  ])("sends patch JSON unchanged: %j", async (patch) => {
    const { stdout, stderr, code } = await runGuideUpdate(patch);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout).applied).toBe(true);
    expect(requests.at(-1)).toEqual({
      method: "PATCH",
      url: "/api/v1/studies/study-1/discussion-guide",
      body: { base_revision: "revision-base", idempotency_key: "request-key", patch },
    });
  });
});
