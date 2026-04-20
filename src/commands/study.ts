import { Command } from "commander";
import { invoke } from "../rpc.js";
import {
  parseIntOption,
  parseJsonArrayOption,
  parseJsonObjectOption,
  die,
  mergeRawJson,
} from "../util.js";

function finish(ok: boolean): never {
  process.exit(ok ? 0 : 1);
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
      const args: Record<string, unknown> = {};
      if (opts.limit !== undefined) args.limit = opts.limit;
      if (opts.cursor) args.cursor = opts.cursor;
      finish(await invoke("cookiy_study_list", args));
    });

  study
    .command("status")
    .description("study record and activity")
    .requiredOption("--study-id <uuid>", "study id")
    .action(async (opts: { studyId: string }) => {
      finish(await invoke("cookiy_activity_get", { study_id: opts.studyId }));
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
        finish(await invoke("cookiy_study_create", payload));
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
        const args: Record<string, unknown> = { content_type: opts.contentType };
        if (opts.imageData) args.image_data = opts.imageData;
        if (opts.imageUrl) args.image_url = opts.imageUrl;
        finish(await invoke("cookiy_media_upload", args));
      },
    );

  // study guide ...
  const guide = study.command("guide").description("discussion guide: get | update");

  guide
    .command("get")
    .description("get discussion guide")
    .requiredOption("--study-id <uuid>", "study id")
    .action(async (opts: { studyId: string }) => {
      finish(await invoke("cookiy_guide_get", { study_id: opts.studyId }));
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
        const args: Record<string, unknown> = {
          study_id: opts.studyId,
          base_revision: opts.baseRevision,
          idempotency_key: opts.idempotencyKey,
          patch: opts.json,
        };
        if (opts.changeMessage !== undefined) args.change_message = opts.changeMessage;
        finish(await invoke("cookiy_guide_patch", args));
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
      const args: Record<string, unknown> = {
        study_id: opts.studyId,
        include_simulation: true,
      };
      if (opts.cursor) args.cursor = opts.cursor;
      finish(await invoke("cookiy_interview_list", args));
    });

  const playback = interview
    .command("playback")
    .description("interview playback: url | content");

  playback
    .command("url")
    .description("playback recording URL")
    .requiredOption("--study-id <uuid>", "study id")
    .option("--interview-id <uuid>", "specific interview")
    .option("--cursor <s>", "pagination cursor")
    .action(
      async (opts: { studyId: string; interviewId?: string; cursor?: string }) => {
        const args: Record<string, unknown> = { study_id: opts.studyId, view: "url" };
        if (opts.interviewId) args.interview_id = opts.interviewId;
        if (opts.cursor) args.cursor = opts.cursor;
        finish(await invoke("cookiy_interview_playback_get", args));
      },
    );

  playback
    .command("content")
    .description("playback transcript content")
    .requiredOption("--study-id <uuid>", "study id")
    .option("--interview-id <uuid>", "specific interview")
    .option("--cursor <s>", "pagination cursor")
    .action(
      async (opts: { studyId: string; interviewId?: string; cursor?: string }) => {
        const args: Record<string, unknown> = {
          study_id: opts.studyId,
          view: "transcript",
        };
        if (opts.interviewId) args.interview_id = opts.interviewId;
        if (opts.cursor) args.cursor = opts.cursor;
        finish(await invoke("cookiy_interview_playback_get", args));
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
        const args: Record<string, unknown> = { study_id: opts.studyId };
        if (opts.personaCount !== undefined) args.persona_count = opts.personaCount;
        if (opts.plainText !== undefined) args.plain_text = opts.plainText;
        finish(await invoke("cookiy_simulated_interview_generate", args));
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
        const args: Record<string, unknown> = { study_id: opts.studyId };
        if (opts.skipSyntheticInterview) args.skip_synthetic_interview = true;
        finish(await invoke("cookiy_report_generate", args));
      },
    );

  report
    .command("content")
    .description("report content JSON")
    .requiredOption("--study-id <uuid>", "study id")
    .action(async (opts: { studyId: string }) => {
      finish(await invoke("cookiy_report_content_get", { study_id: opts.studyId }));
    });

  report
    .command("link")
    .description("report share link")
    .requiredOption("--study-id <uuid>", "study id")
    .action(async (opts: { studyId: string }) => {
      finish(await invoke("cookiy_report_share_link_get", { study_id: opts.studyId }));
    });
}
