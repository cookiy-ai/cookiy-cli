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

- Successful V1 responses print `data` to stdout. Standard API errors print the server's `error` to stderr and exit nonzero. HTTP 401 errors additionally receive `details.login_url` derived from the configured server; existing detail fields are preserved, and non-object details are retained as `details.server_details`.
- Other V1 runtime errors print JSON `{code,message,details?}` to stderr: `HTTP_<status>` for nonstandard HTTP errors, `NETWORK_ERROR` for connection failures, `REQUEST_TIMEOUT` for HTTP timeouts, and `CLI_ERROR` for unexpected exceptions. A nonstandard 401 uses `UNAUTHORIZED` with the same login hint. Local token/argument errors and help/save-token messages keep their existing text format; stderr is not universally JSON.
- `study guide update --json` sends the JSON patch unchanged. Use nested JSON, for example `'{"meta":{"sample_size":8}}'`; dotted keys are not expanded.
- Synthetic interviews accept `--persona`. The old `--plain-text` flag is not supported for this command.
- `study guide wait` and `study report wait` are no longer supported. Move polling to the calling workflow: query `study status --study-id <id>`, then call `study guide get --study-id <id>` or `study report link --study-id <id>` when ready. The workflow owns business-state checks, polling intervals, and wait timeouts; the CLI makes one API request per command and preserves the response data.
- Early pipe closure (for example `| head`) is silent and preserves the command's exit status. Other output-write failures print a text diagnostic when stderr is usable and exit nonzero.
- `quant raw-response` prints the full response data as JSON, including `csv` and metadata. To export CSV, pipe through `jq -r '.csv'`.
