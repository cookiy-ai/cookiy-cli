import { VERSION } from "./config.js";

export function printCliReference(): void {
  console.log(`NAME
    cookiy — command-line client for Cookiy AI

SYNOPSIS
    cookiy [GLOBAL OPTION ...] <command> [ARG ...]

VERSION
    ${VERSION}

DESCRIPTION
    Standalone command-line client for the Cookiy AI platform.
    Run: cookiy <command>   (or npx cookiy-cli <command>)

    Long options use kebab-case; they are sent as snake_case JSON fields
    (e.g. --study-id → study_id).
    --wait passes server-side wait flags (no polling).
    --json merges extra JSON fields into the tool request, or provides the
    guide patch payload.
    Numeric sid for quant: --survey-id 12345 is sent as JSON string.

GLOBAL OPTIONS
    --token <path>    Raw token file (default ~/.cookiy/token.txt; same as COOKIY_CREDENTIALS)
    --api-url <url>   Full JSON-RPC endpoint URL (overrides COOKIY_API_URL)
    --server-url <u>  API origin if endpoint URL not set

ENVIRONMENT
    COOKIY_CREDENTIALS       Path to raw token file
    COOKIY_API_URL           Full JSON-RPC endpoint URL
    COOKIY_API_RPC_TIMEOUT   Max seconds for API calls (default 600)
    COOKIY_SERVER_URL        API origin if endpoint URL not set

COMMANDS

help — offline CLI reference
    Usage:   cookiy help
    Note:    Prints this reference. No credentials needed.

study list — list studies
    Usage:   cookiy study list [--limit <n>] [--cursor <s>]

study create — create study from natural language
    Usage:   cookiy study create --query <s> [--thinking <s>] [--attachments <json-array>] [--wait] [--timeout-ms <n>]
    Flags:   --query (required), --thinking, --attachments (JSON array),
             --wait (server-side wait_for_guide — off by default),
             --timeout-ms (only honored when --wait is set)

study status — study record and activity
    Usage:   cookiy study status --study-id <uuid>

study guide get
    Usage:   cookiy study guide get --study-id <uuid>

study guide update — apply patch to discussion guide
    Usage:   cookiy study guide update --study-id <uuid> --base-revision <s> --idempotency-key <s> [--change-message <s>] --json '<patch>'

study upload — attach media (image upload)
    Usage:   cookiy study upload --content-type <s> (--image-data <s> | --image-url <s>)

study interview list | playback url|content
    Usage:   cookiy study interview list --study-id <uuid> [--cursor <s>]
             cookiy study interview playback url --study-id <uuid> [--interview-id <uuid>] [--cursor <s>]
             cookiy study interview playback content --study-id <uuid> [--interview-id <uuid>] [--cursor <s>]
    Note:    list always includes synthetic interviews.
             When --interview-id is omitted, playback returns a paginated list.

study run-synthetic-user start — run synthetic user interviews
    Usage:   cookiy study run-synthetic-user start --study-id <uuid> [--persona-count <n>] [--plain-text <s>] [--wait] [--timeout-ms <n>]

recruit start — launch participant recruitment
    Usage:   cookiy recruit start [--study-id <uuid>] [--survey-public-url <url>] [--confirmation-token <s>] [--plain-text <s>] [--incremental-participants <n>]
    Note:    --survey-public-url auto-sets recruit_mode=quant_survey.
             incremental_participants is auto-capped to remaining sample size.

study report generate | content | link | wait
    Usage:   cookiy study report generate --study-id <uuid> [--skip-synthetic-interview] [--wait]
             cookiy study report content --study-id <uuid> [--wait] [--timeout-ms <n>]
             cookiy study report link --study-id <uuid>
             cookiy study report wait --study-id <uuid> [--timeout-ms <n>]

quant list — list surveys
    Usage:   cookiy quant list

quant create — create survey (multi-language)
    Usage:   cookiy quant create --json '<obj>'

quant get — survey detail
    Usage:   cookiy quant get --survey-id <n>

quant update — patch survey
    Usage:   cookiy quant update --survey-id <n> --json '<obj>'

quant status — combined survey + panel recruitment status
    Usage:   cookiy quant status --survey-id <n>

quant report — survey report (structured JSON)
    Usage:   cookiy quant report --survey-id <n>

quant raw-response — raw survey responses as CSV
    Usage:   cookiy quant raw-response --survey-id <n> [--include-incomplete]
    Output:  Raw CSV on stdout. Redirect to a file for large surveys.

billing balance
    Usage:   cookiy billing balance

billing transactions — wallet ledger
    Usage:   cookiy billing transactions [--limit <n>] [--cursor <iso8601>] [--study-id <uuid>] [--survey-id <sid>]

billing checkout
    Usage:   cookiy billing checkout --amount-usd-cents <n>

billing price-table
    Usage:   cookiy billing price-table

BOOLEAN FLAGS
    --include-raw   --skip-synthetic-interview   --include-incomplete   --wait

save-token — store raw access token from browser sign-in
    Usage:   cookiy save-token <access_token>
             cookiy save-token '{"access_token":"eyJ..."}'
    Flow:    Verifies the token against the API, then writes to --token path.

FILES
    Default token file: ~/.cookiy/token.txt`);
}
