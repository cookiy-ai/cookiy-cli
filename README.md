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

- Successful V1 responses print `data` to stdout; API errors print `error` to stderr and exit nonzero.
- `study guide update --json` sends the JSON patch unchanged. Use nested JSON, for example `'{"meta":{"sample_size":8}}'`; dotted keys are not expanded.
- Synthetic interviews accept `--persona`. The old `--plain-text` flag is not supported for this command.
- Guide/report wait commands print only the final result on stdout. Timeout and generation errors print `{code,message,details}` on stderr; `details` contains the last known state. A timeout does not cancel the server task. The wait budget bounds polling sleeps, while each HTTP request retains its own timeout.
- `quant raw-response` prints the full response data as JSON, including `csv` and metadata. To export CSV, pipe through `jq -r '.csv'`.
