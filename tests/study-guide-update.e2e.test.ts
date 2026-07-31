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
  const requestBodies: unknown[] = [];

  beforeAll(async () => {
    server = await startMockServer((req, res) => {
      expect(req.method).toBe("PATCH");
      expect(req.url).toBe("/api/v1/studies/study-1/discussion-guide");

      let rawBody = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        rawBody += chunk;
      });
      req.on("end", () => {
        requestBodies.push(JSON.parse(rawBody));
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

  async function updateGuide(patch: Record<string, unknown>): Promise<void> {
    const { stderr, code } = await runGuideUpdate(patch);

    expect(code).toBe(0);
    expect(stderr).toBe("");
  }

  it("expands a dotted sample-size path before calling REST", async () => {
    await updateGuide({ "research_overview.sample_size": 8 });

    expect(requestBodies.at(-1)).toEqual({
      base_revision: "revision-base",
      idempotency_key: "request-key",
      patch: {
        research_overview: {
          sample_size: 8,
        },
      },
    });
  });

  it("expands a dotted interview-duration path before calling REST", async () => {
    await updateGuide({ "research_overview.interview_duration": 30 });

    expect(requestBodies.at(-1)).toEqual({
      base_revision: "revision-base",
      idempotency_key: "request-key",
      patch: {
        research_overview: {
          interview_duration: 30,
        },
      },
    });
  });

  it("merges dotted siblings into the same nested object", async () => {
    await updateGuide({
      "research_overview.sample_size": 8,
      "research_overview.interview_duration": 30,
    });

    expect(requestBodies.at(-1)).toEqual({
      base_revision: "revision-base",
      idempotency_key: "request-key",
      patch: {
        research_overview: {
          sample_size: 8,
          interview_duration: 30,
        },
      },
    });
  });

  it("rejects conflicting parent and child paths", async () => {
    const requestCount = requestBodies.length;
    const { stderr, code } = await runGuideUpdate({
      research_overview: 1,
      "research_overview.sample_size": 8,
    });

    expect(code).toBe(1);
    expect(stderr).toContain("Conflicting patch path");
    expect(requestBodies).toHaveLength(requestCount);
  });

  it("rejects explicit empty-object conflicts in either key order", async () => {
    const requestCount = requestBodies.length;
    for (const patch of [
      { research_overview: {}, "research_overview.sample_size": 8 },
      { "research_overview.sample_size": 8, research_overview: {} },
    ]) {
      const { stderr, code } = await runGuideUpdate(patch);
      expect(code).toBe(1);
      expect(stderr).toContain("Conflicting patch path");
    }
    expect(requestBodies).toHaveLength(requestCount);
  });

  it("rejects prototype-polluting paths", async () => {
    const requestCount = requestBodies.length;
    const { stderr, code } = await runGuideUpdate({
      "__proto__.polluted": true,
    });

    expect(code).toBe(1);
    expect(stderr).toContain("Invalid patch path");
    expect(requestBodies).toHaveLength(requestCount);
  });

  it("treats inherited object names as ordinary own path segments", async () => {
    await updateGuide({ "toString.value": "safe" });

    expect(requestBodies.at(-1)).toEqual({
      base_revision: "revision-base",
      idempotency_key: "request-key",
      patch: {
        toString: {
          value: "safe",
        },
      },
    });
  });
});
