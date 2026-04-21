import { Command } from "commander";
import { v1, runV1 } from "../v1Client.js";
import { parseJsonObjectOption } from "../util.js";

export function registerQuant(program: Command): void {
  const quant = program.command("quant").description(
    "Quantitative surveys: list, create, get, update, status, report, raw-response",
  );

  quant
    .command("list")
    .description("list surveys visible to operator")
    .action(async () => {
      await runV1(() => v1.get("/v1/quant/surveys"));
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
      await runV1(() => v1.post("/v1/quant/surveys", opts.json));
    });

  quant
    .command("get")
    .description("survey detail")
    .requiredOption("--survey-id <id>", "numeric sid")
    .option("--language <lang>", "language code")
    .action(async (opts: { surveyId: string; language?: string }) => {
      const query: Record<string, unknown> = {};
      if (opts.language) query.language = opts.language;
      await runV1(() =>
        v1.get(`/v1/quant/surveys/${encodeURIComponent(opts.surveyId)}`, query),
      );
    });

  quant
    .command("update")
    .description("patch survey")
    .requiredOption("--survey-id <id>", "numeric sid")
    .requiredOption(
      "--json <obj>",
      "JSON object with survey/groups/questions/quotas_*",
      parseJsonObjectOption("json"),
    )
    .action(
      async (opts: { surveyId: string; json: Record<string, unknown> }) => {
        await runV1(() =>
          v1.patch(
            `/v1/quant/surveys/${encodeURIComponent(opts.surveyId)}`,
            opts.json,
          ),
        );
      },
    );

  quant
    .command("status")
    .description("combined survey + recruit status")
    .requiredOption("--survey-id <id>", "numeric sid")
    .action(async (opts: { surveyId: string }) => {
      await runV1(() =>
        v1.get(
          `/v1/quant/surveys/${encodeURIComponent(opts.surveyId)}/status`,
        ),
      );
    });

  quant
    .command("report")
    .description("survey report (structured JSON + raw)")
    .requiredOption("--survey-id <id>", "numeric sid")
    .action(async (opts: { surveyId: string }) => {
      await runV1(() =>
        v1.get(
          `/v1/quant/surveys/${encodeURIComponent(opts.surveyId)}/report`,
        ),
      );
    });

  quant
    .command("raw-response")
    .description("raw survey responses as CSV")
    .requiredOption("--survey-id <id>", "numeric sid")
    .option("--include-incomplete", "include incomplete responses", false)
    .action(
      async (opts: { surveyId: string; includeIncomplete?: boolean }) => {
        const query: Record<string, unknown> = {};
        if (!opts.includeIncomplete) query.only_completed = "true";
        await runV1(async () => {
          const r = (await v1.get(
            `/v1/quant/surveys/${encodeURIComponent(opts.surveyId)}/raw-responses`,
            query,
          )) as { csv?: string } | null;
          if (r?.csv) {
            console.log(r.csv);
            return undefined;
          }
          return r;
        });
      },
    );
}
