# cookiy-cli

Command-line client for [Cookiy AI](https://cookiy.ai) — run user research, quant surveys, and recruit participants from your terminal.

## Install

```bash
# Install once (requires Node.js 18+)
npm install -g cookiy-cli

# Upgrade
npm update -g cookiy-cli
```

After install, the binary is available as `cookiy` on your PATH.

## Sign in

1. Open the sign-in URL in your browser: <https://s-api.cookiy.ai/oauth/cli/start>
2. Log in and copy the access token.
3. Save it:

   ```bash
   cookiy save-token <access_token>
   ```

The token is verified against the API and written to `~/.cookiy/token.txt` with mode `0600`.

## Quick reference

```bash
cookiy help                          # full offline reference
cookiy study list --limit 10
cookiy study create --query "..." --wait
cookiy study status --study-id <uuid>
cookiy study report generate --study-id <uuid> --wait
cookiy quant list
cookiy quant get --survey-id 12345
cookiy recruit start --study-id <uuid> --plain-text "..."
cookiy billing balance
cookiy billing transactions --limit 50
```

Run `cookiy <command> --help` for per-command options.

## Environment

| Variable | Purpose |
|---|---|
| `COOKIY_CREDENTIALS` | Path to token file (default `~/.cookiy/token.txt`) |
| `COOKIY_API_URL` | Full JSON-RPC endpoint URL |
| `COOKIY_SERVER_URL` | API origin when endpoint URL is not set |
| `COOKIY_API_RPC_TIMEOUT` | Max seconds per API call (default `600`) |

## License

MIT © Cookiy AI
