import { Command } from "commander";
import { invoke, callTool } from "../rpc.js";
import { parseJsonObjectOption, mergeRawJson } from "../util.js";

function finish(ok: boolean): never {
  process.exit(ok ? 0 : 1);
}

export function registerQuant(program: Command): void {
  const quant = program.command("quant").description(
    "Quantitative surveys: list, create, get, update, status, report, raw-response",
  );

  quant
    .command("list")
    .description("list surveys visible to operator")
    .action(async () => {
      finish(await invoke("cookiy_quant_survey_list", {}));
    });

  quant
    .command("create")
    .description("create survey (multi-language)")
    .requiredOption(
      "--json <obj>",
      "JSON object: survey_title, languages[], groups[], quotas[], ...",
      parseJsonObjectOption("json"),
    )
    .action(async (opts: { json: Record<string, unknown> }) => {
      finish(await invoke("cookiy_quant_survey_create", opts.json));
    });

  quant
    .command("get")
    .description("survey detail")
    .requiredOption("--survey-id <id>", "numeric sid (sent as string)")
    .action(async (opts: { surveyId: string }) => {
      finish(await invoke("cookiy_quant_survey_detail", { survey_id: String(opts.surveyId) }));
    });

  quant
    .command("update")
    .description("patch survey")
    .requiredOption("--survey-id <id>", "numeric sid (sent as string)")
    .requiredOption(
      "--json <obj>",
      "JSON object with survey/groups/questions/quotas_*",
      parseJsonObjectOption("json"),
    )
    .action(
      async (opts: { surveyId: string; json: Record<string, unknown> }) => {
        const payload = mergeRawJson(
          { survey_id: String(opts.surveyId) },
          JSON.stringify(opts.json),
        );
        finish(await invoke("cookiy_quant_survey_patch", payload));
      },
    );

  quant
    .command("status")
    .description("combined survey + recruit status")
    .requiredOption("--survey-id <id>", "numeric sid")
    .action(async (opts: { surveyId: string }) => {
      finish(await invoke("cookiy_quant_status", { survey_id: String(opts.surveyId) }));
    });

  quant
    .command("report")
    .description("survey report (structured JSON + raw)")
    .requiredOption("--survey-id <id>", "numeric sid")
    .action(async (opts: { surveyId: string }) => {
      finish(await invoke("cookiy_quant_survey_report", { survey_id: String(opts.surveyId) }));
    });

  quant
    .command("raw-response")
    .description("raw survey responses as CSV")
    .requiredOption("--survey-id <id>", "numeric sid")
    .option("--include-incomplete", "include incomplete responses", false)
    .action(
      async (opts: { surveyId: string; includeIncomplete?: boolean }) => {
        const args: Record<string, unknown> = { survey_id: String(opts.surveyId) };
        if (opts.includeIncomplete) args.include_incomplete = true;
        const result = (await callTool(
          "cookiy_quant_survey_raw_responses",
          args,
        )) as { raw_results?: { raw?: string } } | null;
        if (result?.raw_results?.raw) {
          console.log(result.raw_results.raw);
        }
        process.exit(0);
      },
    );
}
