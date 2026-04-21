import { Command } from "commander";
import { v1, runV1 } from "../v1Client.js";
import { parseIntOption } from "../util.js";

export function registerBilling(program: Command): void {
  const billing = program
    .command("billing")
    .description("Billing: balance, checkout, price-table, transactions");

  billing
    .command("balance")
    .description("one-line balance summary")
    .action(async () => {
      await runV1(() => v1.get("/v1/billing/balance"));
    });

  billing
    .command("checkout")
    .description("create Stripe checkout session")
    .requiredOption(
      "--amount-usd-cents <n>",
      "USD cents (min 100). Internally mapped to amount_cents.",
      parseIntOption("amount-usd-cents"),
    )
    .action(async (opts: { amountUsdCents: number }) => {
      await runV1(() =>
        v1.post("/v1/billing/cash-credit/checkout", {
          amount_cents: opts.amountUsdCents,
        }),
      );
    });

  billing
    .command("price-table")
    .description("current pricing table")
    .action(async () => {
      await runV1(() => v1.get("/v1/billing/price-table"));
    });

  billing
    .command("transactions")
    .description("wallet ledger")
    .option("--limit <n>", "max items", parseIntOption("limit"))
    .option("--cursor <iso8601>", "pagination cursor")
    .option("--study-id <uuid>", "filter by study")
    .option("--survey-id <id>", "filter by survey sid (sent as string)")
    .action(
      async (opts: {
        limit?: number;
        cursor?: string;
        studyId?: string;
        surveyId?: string;
      }) => {
        const query: Record<string, unknown> = {};
        if (opts.limit !== undefined) query.limit = opts.limit;
        if (opts.cursor) query.cursor = opts.cursor;
        if (opts.studyId) query.study_id = opts.studyId;
        if (opts.surveyId !== undefined) query.survey_id = String(opts.surveyId);
        await runV1(() => v1.get("/v1/billing/transactions", query));
      },
    );
}
