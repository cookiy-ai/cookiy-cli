# cookiy-cli

Command-line client for Cookiy AI — run user research, quant surveys, and recruit participants from your terminal.

## Install

```bash
# Install once (requires Node.js 18+)
npm install -g cookiy-cli

# Upgrade
npm update -g cookiy-cli
```

## Output and request conventions

- Successful V1 responses print `data` to stdout. Standard API errors print the server's `error` to stderr and exit nonzero. HTTP 401 errors additionally receive a top-level `login_url`; precedence is server top-level `login_url`, server `details.login_url`, then the CLI-derived configured-server URL. The server's `details` value is unchanged.
- Other V1 runtime errors print JSON `{code,message,details?}` to stderr: `HTTP_<status>` for nonstandard HTTP errors, `NETWORK_ERROR` for connection failures, `REQUEST_TIMEOUT` for HTTP timeouts, and `CLI_ERROR` for unexpected exceptions. A nonstandard 401 uses `UNAUTHORIZED` with the same login hint. Local token/argument errors and help/save-token messages keep their existing text format; stderr is not universally JSON.
- `study guide update --json` accepts both nested JSON (`'{"meta":{"sample_size":8}}'`) and dotted keys (`'{"meta.sample_size":8}'`). Dotted keys are expanded before the REST request is sent.
- Synthetic interviews accept `--persona`. The old `--plain-text` flag is not supported for this command.
- `study create` waits for the discussion guide and returns the ready canonical guide, so `study guide wait` is not supported.
- `study report wait --study-id <id> [--timeout-ms <n>]` polls the Study activity every 15 seconds, with the final sleep capped by the remaining wait budget and followed by one last Activity request. Each HTTP request keeps the normal RPC timeout. `report_generation_in_progress` keeps waiting; `report_ready` prints the share-link response; `report_failed`, `report_not_requested`, missing states, and unknown states fail immediately. When the wait budget is exhausted, the command prints the latest complete Study activity to stdout and exits nonzero so a calling workflow can inspect it and retry.
- Early pipe closure (for example `| head`) is silent and preserves the command's exit status. Other output-write failures print a text diagnostic when stderr is usable and exit nonzero.
- `quant raw-response` prints the full response data as JSON, including `csv` and metadata. To export CSV, pipe through `jq -r '.csv'`.
