import { Command } from "commander";
import { v1, runV1 } from "../v1Client.js";
import {
  parseIntOption,
  parseJsonArrayOption,
  parseJsonObjectOption,
  die,
  mergeRawJson,
} from "../util.js";

function isGuidePending(status: string): boolean {
  return [
    "",
    "queued",
    "running",
    "guide_generation_queued",
    "guide_generation_in_progress",
  ].includes(status);
}

function isGuideFailed(status: string): boolean {
  return ["failed", "guide_generation_failed"].includes(status);
}

function isReportPending(status: string): boolean {
  return [
    "",
    "report_not_requested",
    "report_requested",
    "report_generation_in_progress",
  ].includes(status);
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
    .command("wait")
    .description("poll until guide generation completes or timeout")
    .requiredOption("--study-id <uuid>", "study id")
    .option(
      "--timeout-ms <n>",
      "polling timeout in ms (default 120000)",
      parseIntOption("timeout-ms"),
      120000,
    )
    .action(async (opts: { studyId: string; timeoutMs: number }) => {
      await runV1(async () => {
        const deadline = Date.now() + opts.timeoutMs;
        const sid = encodeURIComponent(opts.studyId);
        let guideObj: unknown = {};
        while (true) {
          const activity = (await v1.get(`/v1/studies/${sid}/activity`)) as
            | { sources?: { guide?: unknown } }
            | null;
          guideObj = activity?.sources?.guide ?? {};
          const status =
            (guideObj as { status?: string } | null)?.status ?? "";
          if (isGuideFailed(status)) {
            console.error(JSON.stringify(guideObj, null, 2));
            throw new Error("Guide generation failed");
          }
          if (!isGuidePending(status)) {
            return v1.get(`/v1/studies/${sid}/discussion-guide`);
          }
          if (Date.now() >= deadline) {
            console.log(JSON.stringify(guideObj, null, 2));
            throw new Error(
              `Timeout waiting for guide generation (${opts.timeoutMs}ms)`,
            );
          }
          await new Promise((r) => setTimeout(r, 15000));
        }
      });
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
    .option("--plain-text <s>", "persona / profile description")
    .action(
      async (opts: {
        studyId: string;
        personaCount?: number;
        plainText?: string;
      }) => {
        const body: Record<string, unknown> = {};
        if (opts.personaCount !== undefined) body.persona_count = opts.personaCount;
        if (opts.plainText !== undefined) body.plain_text = opts.plainText;
        await runV1(() =>
          v1.post(
            `/v1/studies/${encodeURIComponent(opts.studyId)}/fake-interview`,
            body,
          ),
        );
      },
    );

  // study report ...
  const report = study.command("report").description("study report: generate | content | link");

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
    .description(
      "poll until report generation completes, then print share link",
    )
    .requiredOption("--study-id <uuid>", "study id")
    .option(
      "--timeout-ms <n>",
      "polling timeout in ms (default 300000)",
      parseIntOption("timeout-ms"),
      300000,
    )
    .action(async (opts: { studyId: string; timeoutMs: number }) => {
      await runV1(async () => {
        const deadline = Date.now() + opts.timeoutMs;
        const sid = encodeURIComponent(opts.studyId);
        let reportObj: unknown = {};
        while (true) {
          const activity = (await v1.get(`/v1/studies/${sid}/activity`)) as
            | { sources?: { report?: unknown } }
            | null;
          reportObj = activity?.sources?.report ?? {};
          const status =
            (reportObj as { status?: string } | null)?.status ?? "";
          if (status === "report_ready") break;
          if (status === "report_failed") {
            console.error(JSON.stringify(reportObj, null, 2));
            throw new Error("Report generation failed");
          }
          if (!isReportPending(status)) {
            console.error(JSON.stringify(reportObj, null, 2));
            throw new Error(`Unexpected report status: ${status}`);
          }
          if (Date.now() >= deadline) {
            console.error(JSON.stringify(reportObj, null, 2));
            throw new Error(
              `Timeout waiting for report generation (${opts.timeoutMs}ms)`,
            );
          }
          await new Promise((r) => setTimeout(r, 15000));
        }
        return await v1.post(`/v1/studies/${sid}/report/share-link`, {});
      });
    });
}
