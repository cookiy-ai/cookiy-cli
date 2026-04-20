import { Command } from "commander";
import { runtime, resolveApiEndpoint, VERSION } from "./config.js";
import { loadCredentials, runSaveToken } from "./auth.js";
import { printCliReference } from "./help.js";
import { registerStudy } from "./commands/study.js";
import { registerQuant } from "./commands/quant.js";
import { registerRecruit } from "./commands/recruit.js";
import { registerBilling } from "./commands/billing.js";

const program = new Command();

program
  .name("cookiy")
  .description("Cookiy CLI — command-line client for Cookiy AI")
  .version(VERSION, "-v, --version", "print version")
  .option("--server-url <url>", "API origin (default: https://s-api.cookiy.ai)")
  .option("--api-url <url>", "full JSON-RPC endpoint (overrides COOKIY_API_URL)")
  .option("--token <path>", "token file path (default: ~/.cookiy/token.txt)")
  .showHelpAfterError()
  .addHelpText(
    "after",
    `
Examples:
  $ cookiy save-token eyJhbGciOi...
  $ cookiy study list --limit 10
  $ cookiy study create --query "..." --wait
  $ cookiy study report generate --study-id 123 --wait
  $ cookiy quant list
  $ cookiy billing transactions --limit 50

Run 'cookiy help' for the full command reference.
Sign in:  https://s-api.cookiy.ai/oauth/cli/start`,
  );

// Sync global options → runtime, then (for most commands) load credentials
program.hook("preAction", (_thisCmd, actionCmd) => {
  const g = program.opts<{ serverUrl?: string; apiUrl?: string; token?: string }>();
  if (g.serverUrl) runtime.serverUrlOpt = g.serverUrl;
  if (g.apiUrl) runtime.apiUrlOpt = g.apiUrl;
  if (g.token) runtime.tokenPath = g.token;

  const name = actionCmd.name();
  if (name === "save-token" || name === "help") return;

  resolveApiEndpoint();
  loadCredentials();
});

// Public commands (no credentials needed)
program
  .command("help")
  .description("print the full offline CLI reference")
  .action(() => {
    printCliReference();
  });

program
  .command("save-token")
  .description("validate and save an access token (from browser sign-in)")
  .argument("<token_or_json>", "raw access_token string or JSON with access_token field")
  .action(async (input: string) => {
    // Global options may have been supplied — apply them first
    const g = program.opts<{ serverUrl?: string; apiUrl?: string; token?: string }>();
    if (g.serverUrl) runtime.serverUrlOpt = g.serverUrl;
    if (g.apiUrl) runtime.apiUrlOpt = g.apiUrl;
    if (g.token) runtime.tokenPath = g.token;

    await runSaveToken(input);
  });

// Authenticated commands
registerStudy(program);
registerQuant(program);
registerRecruit(program);
registerBilling(program);

// Run
program.parseAsync(process.argv).catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
});
