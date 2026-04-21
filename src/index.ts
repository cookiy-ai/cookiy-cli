import { Command } from "commander";
import { runtime, VERSION } from "./config.js";
import { loadCredentials, runSaveToken } from "./auth.js";
import { scheduleBackgroundUpdate } from "./update-check.js";
import { registerStudy } from "./commands/study.js";
import { registerQuant } from "./commands/quant.js";
import { registerRecruit } from "./commands/recruit.js";
import { registerBilling } from "./commands/billing.js";

scheduleBackgroundUpdate();

const program = new Command();

program.helpCommand(false);
program
  .name("cookiy")
  .description(
    "Cookiy CLI - command-line client for Cookiy AI, end-to-end user research at scale.",
  )
  .version(VERSION, "-v, --version", "Output the version number")
  .option(
    "--token <path>",
    "Token file path (default ~/.cookiy/token.txt)",
  )
  .showHelpAfterError('(run "cookiy --help" for usage)')
  .addHelpText(
    "after",
    `
Examples:
  $ cookiy save-token eyJhbGciOi...
  $ cookiy study list --limit 10
  $ cookiy study create --query "..."
  $ cookiy study report generate --study-id 123
  $ cookiy quant list
  $ cookiy billing transactions --limit 50

Sign in:  https://s-api.cookiy.ai/oauth/cli/start`,
  );

// Sync global options → runtime, then (for most commands) load credentials
program.hook("preAction", (_thisCmd, actionCmd) => {
  const g = program.opts<{ token?: string }>();
  if (g.token) runtime.tokenPath = g.token;

  if (actionCmd.name() === "save-token") return;

  loadCredentials();
});

program
  .command("save-token")
  .description("Validate and save an access token (from browser sign-in)")
  .argument("<token_or_json>", "raw access_token string or JSON with access_token field")
  .action(async (input: string) => {
    const g = program.opts<{ token?: string }>();
    if (g.token) runtime.tokenPath = g.token;
    await runSaveToken(input);
  });

registerStudy(program);
registerQuant(program);
registerRecruit(program);
registerBilling(program);

// Suppress the auto-generated `help [command]` entry at every depth — we
// rely on `-h` / `--help` exclusively, matching `claude --help` style.
function disableHelpCommand(cmd: Command): void {
  cmd.helpCommand(false);
  for (const sub of cmd.commands) disableHelpCommand(sub);
}
disableHelpCommand(program);

program.parseAsync(process.argv).catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
});
