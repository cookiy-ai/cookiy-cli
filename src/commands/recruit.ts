import { Command } from "commander";
import { invoke } from "../rpc.js";
import { parseIntOption, die } from "../util.js";

function finish(ok: boolean): never {
  process.exit(ok ? 0 : 1);
}

export function registerRecruit(program: Command): void {
  const recruit = program
    .command("recruit")
    .description("Participant recruitment (auto-detects qualitative vs quant)");

  recruit
    .command("start")
    .description("launch recruitment (or incrementally add participants)")
    .option("--study-id <uuid>", "study id (required for interview studies)")
    .option("--survey-public-url <url>", "public survey URL (auto-selects quant mode)")
    .option("--confirmation-token <s>", "step-2 confirmation token")
    .option("--plain-text <s>", "audience description / free-text brief")
    .option(
      "--incremental-participants <n>",
      "add N participants on top of existing",
      parseIntOption("incremental-participants"),
    )
    .action(
      async (opts: {
        studyId?: string;
        surveyPublicUrl?: string;
        confirmationToken?: string;
        plainText?: string;
        incrementalParticipants?: number;
      }) => {
        // Step 1 (preview) requires --plain-text; step 2 only needs --confirmation-token
        if (!opts.confirmationToken && !opts.plainText) {
          die("recruit start: --plain-text is required");
        }

        const args: Record<string, unknown> = { force_reconfigure: true };
        if (opts.studyId) args.study_id = opts.studyId;
        if (opts.surveyPublicUrl) {
          args.survey_public_url = opts.surveyPublicUrl;
          args.recruit_mode = "quant_survey";
        }
        if (opts.confirmationToken) args.confirmation_token = opts.confirmationToken;
        if (opts.plainText !== undefined) args.plain_text = opts.plainText;
        if (opts.incrementalParticipants !== undefined) {
          args.incremental_participants = opts.incrementalParticipants;
        }
        finish(await invoke("cookiy_recruit_create", args));
      },
    );
}
