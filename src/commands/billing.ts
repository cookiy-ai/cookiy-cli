import { Command } from "commander";
import { invoke } from "../rpc.js";
import { parseIntOption } from "../util.js";

function finish(ok: boolean): never {
  process.exit(ok ? 0 : 1);
}

export function registerBilling(program: Command): void {
  const billing = program
    .command("billing")
    .description("Billing: balance, checkout, price-table, transactions");

  billing
    .command("balance")
    .description("one-line balance summary")
    .action(async () => {
      finish(await invoke("cookiy_balance_get", {}));
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
      finish(await invoke("cookiy_billing_cash_checkout", { amount_cents: opts.amountUsdCents }));
    });

  billing
    .command("price-table")
    .description("current pricing table")
    .action(async () => {
      finish(await invoke("cookiy_billing_price_table", {}));
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
        const args: Record<string, unknown> = {};
        if (opts.limit !== undefined) args.limit = opts.limit;
        if (opts.cursor) args.cursor = opts.cursor;
        if (opts.studyId) args.study_id = opts.studyId;
        if (opts.surveyId !== undefined) args.survey_id = String(opts.surveyId);
        finish(await invoke("cookiy_billing_transactions", args));
      },
    );
}
