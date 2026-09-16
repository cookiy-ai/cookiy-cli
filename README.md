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
- Guide/report wait commands print only the final result on stdout. Timeout and generation errors print `{code,message,details}` on stderr; `details` contains the last known state. Every sleep is followed by another status check, including at the deadline. A timeout does not cancel the server task. The wait budget bounds polling sleeps, not total elapsed time: the final status/result requests retain their own HTTP timeout.
- Early pipe closure (for example `| head`) is silent and preserves the command's exit status. Other output-write failures print a text diagnostic when stderr is usable and exit nonzero.
- `quant raw-response` prints the full response data as JSON, including `csv` and metadata. To export CSV, pipe through `jq -r '.csv'`.
