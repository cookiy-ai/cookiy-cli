import { Command } from "commander";
import { v1, runV1 } from "../v1Client.js";
import {
  parseIntOption,
  parseJsonArrayOption,
  parseJsonObjectOption,
  die,
  CliError,
  exitWithOutput,
  mergeRawJson,
} from "../util.js";

const REPORT_POLL_INTERVAL_MS = 15000;

async function waitForReport(
  studyId: string,
  timeoutMs: number,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = Math.min(
    REPORT_POLL_INTERVAL_MS,
    Math.max(1, Math.floor(timeoutMs / 2)),
  );
  let lastActivity: unknown;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return exitWithOutput({
        code: 1,
        stdout: JSON.stringify(lastActivity, null, 2),
      });
    }

    const activity = await v1.get(
      `/v1/studies/${studyId}/activity`,
      undefined,
      remaining,
    );
    lastActivity = activity;
    const report = (
      activity as {
        sources?: { report?: Record<string, unknown> };
      } | null
    )?.sources?.report ?? {};
    const status = typeof report.status === "string" ? report.status : "";

    if (status === "report_ready") {
      return v1.post(`/v1/studies/${studyId}/report/share-link`, {});
    }
    if (status === "report_failed") {
      throw new CliError(
        "GENERATION_FAILED",
        "Report generation failed",
        report,
      );
    }
    if (status === "report_not_requested") {
      throw new CliError(
        "REPORT_NOT_REQUESTED",
        "Report generation has not been requested",
        report,
      );
    }
    if (status !== "report_generation_in_progress") {
      throw new CliError(
        "UNEXPECTED_STATUS",
        `Unexpected report status: ${status || "(missing)"}`,
        report,
      );
    }

    const sleepMs = Math.min(
      pollIntervalMs,
      Math.max(0, deadline - Date.now()),
    );
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

export function registerStudy(program: Command): void {
  const study = program
    .command("study")
    .description("Studies: list, create, status, guide, interview, report, upload");

  study
    .command("list")
    .description("list studies")
    .option("--limit <n>", "max items", parseIntOption("limit"))
    .option("--cursor <s>", "pagination cursor")
    .action(async (opts: { limit?: number; cursor?: string }) => {
      const query: Record<string, unknown> = {};
      if (opts.limit !== undefined) query.limit = opts.limit;
      if (opts.cursor) query.cursor = opts.cursor;
      await runV1(() => v1.get("/v1/studies", query));
    });

  study
    .command("status")
    .description("study record and activity")
    .requiredOption("--study-id <uuid>", "study id")
    .action(async (opts: { studyId: string }) => {
      await runV1(() =>
        v1.get(`/v1/studies/${encodeURIComponent(opts.studyId)}/activity`),
      );
    });

  study
    .command("create")
    .description("create study from natural language")
    .requiredOption("--query <s>", "natural-language brief")
    .option("--thinking <s>", "thinking / scratch notes")
    .option(
      "--attachments <json-array>",
      "JSON array, e.g. '[{\"s3_key\":\"...\"}]'",
      parseJsonArrayOption("attachments"),
    )
    .option("--json <obj>", "extra JSON fields merged into request")
    .action(
      async (opts: {
        query: string;
        thinking?: string;
        attachments?: unknown[];
        json?: string;
      }) => {
        let payload: Record<string, unknown> = { query: opts.query };
        if (opts.thinking !== undefined) payload.thinking = opts.thinking;
        if (opts.attachments !== undefined) payload.attachments = opts.attachments;
        payload = mergeRawJson(payload, opts.json);
        await runV1(() => v1.post("/v1/studies", payload));
      },
    );

  study
    .command("upload")
    .description("attach media (image upload)")
    .requiredOption("--content-type <s>", "MIME content type")
    .option("--image-data <s>", "base64 image data")
    .option("--image-url <s>", "image url")
    .action(
      async (opts: { contentType: string; imageData?: string; imageUrl?: string }) => {
        if (!opts.imageData && !opts.imageUrl) {
          die("study upload requires --image-data or --image-url");
        }
        const body: Record<string, unknown> = { content_type: opts.contentType };
        if (opts.imageData) body.image_data = opts.imageData;
        if (opts.imageUrl) body.image_url = opts.imageUrl;
        await runV1(() => v1.post("/v1/studies/media/upload", body));
      },
    );

  // study guide ...
  const guide = study.command("guide").description("discussion guide: get | update");

  guide
    .command("get")
    .description("get discussion guide")
    .requiredOption("--study-id <uuid>", "study id")
    .action(async (opts: { studyId: string }) => {
      await runV1(() =>
        v1.get(
          `/v1/studies/${encodeURIComponent(opts.studyId)}/discussion-guide`,
        ),
      );
    });

  guide
    .command("update")
    .description("apply patch to discussion guide")
    .requiredOption("--study-id <uuid>", "study id")
    .requiredOption("--base-revision <s>", "base revision")
    .requiredOption("--idempotency-key <s>", "idempotency key")
    .option("--change-message <s>", "change message")
    .requiredOption(
      "--json <patch>",
      "patch JSON object (required)",
      parseJsonObjectOption("json"),
    )
    .action(
      async (opts: {
        studyId: string;
        baseRevision: string;
        idempotencyKey: string;
        changeMessage?: string;
        json: Record<string, unknown>;
      }) => {
        const body: Record<string, unknown> = {
          base_revision: opts.baseRevision,
          idempotency_key: opts.idempotencyKey,
          patch: opts.json,
        };
        if (opts.changeMessage !== undefined)
          body.change_message = opts.changeMessage;
        await runV1(() =>
          v1.patch(
            `/v1/studies/${encodeURIComponent(opts.studyId)}/discussion-guide`,
            body,
          ),
        );
      },
    );

  // study interview ...
  const interview = study.command("interview").description("interviews: list | playback");

  interview
    .command("list")
    .description("list interviews (includes synthetic)")
    .requiredOption("--study-id <uuid>", "study id")
    .option("--cursor <s>", "pagination cursor")
    .action(async (opts: { studyId: string; cursor?: string }) => {
      const query: Record<string, unknown> = { include_simulation: "true" };
      if (opts.cursor) query.cursor = opts.cursor;
      await runV1(() =>
        v1.get(
          `/v1/studies/${encodeURIComponent(opts.studyId)}/interviews`,
          query,
        ),
      );
    });

  const playback = interview
    .command("playback")
    .description("interview playback: url | content");

  // Unified study-level playback endpoint. Server merged single + batch
  // into one route: `GET /v1/studies/:id/interviews/playback` with optional
  // `interview_id` and `view` (url | transcript | full). When `--interview-id`
  // is omitted, returns playbacks for ALL interviews under the study per
  // `cookiy-study-interview.md`. No client-side pagination — server returns
  // every playback (subject to internal sanity cap). Response shape is
  // always `{ interviews: [...], next_cursor: null }`.
  playback
    .command("url")
    .description("playback recording URL (all interviews if --interview-id omitted)")
    .requiredOption("--study-id <uuid>", "study id")
    .option("--interview-id <uuid>", "specific interview (omit to fetch all)")
    .action(
      async (opts: { studyId: string; interviewId?: string }) => {
        const query: Record<string, unknown> = { view: "url" };
        if (opts.interviewId) query.interview_id = opts.interviewId;
        await runV1(() =>
          v1.get(
            `/v1/studies/${encodeURIComponent(opts.studyId)}/interviews/playback`,
            query,
          ),
        );
      },
    );

  playback
    .command("content")
    .description("playback transcript content (all interviews if --interview-id omitted)")
    .requiredOption("--study-id <uuid>", "study id")
    .option("--interview-id <uuid>", "specific interview (omit to fetch all)")
    .action(
      async (opts: { studyId: string; interviewId?: string }) => {
        const query: Record<string, unknown> = { view: "transcript" };
        if (opts.interviewId) query.interview_id = opts.interviewId;
        await runV1(() =>
          v1.get(
            `/v1/studies/${encodeURIComponent(opts.studyId)}/interviews/playback`,
            query,
          ),
        );
      },
    );

  // study run-synthetic-user ...
  const synthetic = study
    .command("run-synthetic-user")
    .description("synthetic user interviews");

  synthetic
    .command("start")
    .description("start synthetic interviews")
    .requiredOption("--study-id <uuid>", "study id")
    .option(
      "--persona-count <n>",
      "number of personas",
      parseIntOption("persona-count"),
    )
    .option("--persona <s>", "persona / profile description")
    .action(
      async (opts: {
        studyId: string;
        personaCount?: number;
        persona?: string;
      }) => {
        const body: Record<string, unknown> = {};
        if (opts.personaCount !== undefined) body.persona_count = opts.personaCount;
        if (opts.persona !== undefined) body.persona = opts.persona;
        await runV1(() =>
          v1.post(
            `/v1/studies/${encodeURIComponent(opts.studyId)}/fake-interview`,
            body,
          ),
        );
      },
    );

  // study report ...
  const report = study
    .command("report")
    .description("study report: generate | content | link | wait");

  report
    .command("generate")
    .description("generate report")
    .requiredOption("--study-id <uuid>", "study id")
    .option("--skip-synthetic-interview", "skip synthetic interview step", false)
    .action(
      async (opts: {
        studyId: string;
        skipSyntheticInterview?: boolean;
      }) => {
        const body: Record<string, unknown> = {};
        if (opts.skipSyntheticInterview) body.skip_synthetic_interview = true;
        await runV1(() =>
          v1.post(
            `/v1/studies/${encodeURIComponent(opts.studyId)}/report/generate`,
            body,
          ),
        );
      },
    );

  report
    .command("content")
    .description("report content JSON")
    .requiredOption("--study-id <uuid>", "study id")
    .action(async (opts: { studyId: string }) => {
      await runV1(() =>
        v1.get(
          `/v1/studies/${encodeURIComponent(opts.studyId)}/report/content`,
        ),
      );
    });

  report
    .command("link")
    .description("report share link")
    .requiredOption("--study-id <uuid>", "study id")
    .action(async (opts: { studyId: string }) => {
      await runV1(() =>
        v1.post(
          `/v1/studies/${encodeURIComponent(opts.studyId)}/report/share-link`,
          {},
        ),
      );
    });

  report
    .command("wait")
    .description("wait for report generation, then print its share link")
    .requiredOption("--study-id <uuid>", "study id")
    .option(
      "--timeout-ms <n>",
      "polling timeout in ms (default 300000)",
      parseIntOption("timeout-ms"),
      300000,
    )
    .action(async (opts: { studyId: string; timeoutMs: number }) => {
      if (opts.timeoutMs <= 0) {
        die("--timeout-ms requires a positive integer");
      }
      await runV1(() =>
        waitForReport(encodeURIComponent(opts.studyId), opts.timeoutMs),
      );
    });
}
