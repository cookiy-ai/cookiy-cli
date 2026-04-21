import { Command } from "commander";
import { v1, runV1 } from "../v1Client.js";
import { parseIntOption, die } from "../util.js";

export function registerRecruit(program: Command): void {
  const recruit = program
    .command("recruit")
    .description("Participant recruitment (auto-detects qualitative vs quant)");

  recruit
    .command("start")
    .description("launch recruitment (or incrementally add participants)")
    .option("--study-id <uuid>", "study id (required for interview studies)")
    .option(
      "--survey-public-url <url>",
      "public survey URL (auto-selects quant mode)",
    )
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
        if (!opts.confirmationToken && !opts.plainText) {
          die("recruit start: --plain-text is required");
        }

        const isStudyBased = !!opts.studyId;
        const isQuantOnly = !isStudyBased && !!opts.surveyPublicUrl;
        if (!isStudyBased && !isQuantOnly) {
          die(
            "recruit start: either --study-id or --survey-public-url is required",
          );
        }

        const body: Record<string, unknown> = { force_reconfigure: true };
        if (opts.confirmationToken) body.confirmation_token = opts.confirmationToken;
        if (opts.plainText !== undefined) body.plain_text = opts.plainText;
        if (opts.incrementalParticipants !== undefined) {
          body.incremental_participants = opts.incrementalParticipants;
        }

        const step = opts.confirmationToken ? "confirm" : "preview";
        let path: string;
        if (isStudyBased) {
          path = `/v1/studies/${encodeURIComponent(opts.studyId as string)}/recruit/${step}`;
        } else {
          body.survey_public_url = opts.surveyPublicUrl;
          path = `/v1/quant/recruit/${step}`;
        }

        await runV1(() => v1.post(path, body));
      },
    );
}
