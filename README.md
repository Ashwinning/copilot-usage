# @f6n/copilot-usage

> A thin wrapper around the native GitHub Copilot CLI that captures session usage data automatically.

Use `bunx @f6n/copilot-usage` exactly like you'd use `copilot`. All your flags pass through — you just get usage tracking for free.

## Quick start

```bash
# Run without installing (recommended)
bunx @f6n/copilot-usage

# Or install globally
npm install -g @f6n/copilot-usage
copilot-usage
```

## What it does

1. Ensures a repo hook exists at `.github/hooks/f6n-copilot-usage.json`
2. Launches native `copilot` with full interactive behavior and forwarded flags
3. In non-interactive prompt mode (`-p`/`--prompt`), captures usage summaries to `usage-summaries.jsonl`

> **Note:** Running `copilot` directly bypasses this wrapper — those sessions won't be captured.

## Wrapper flags

All non-`--f6n*` flags are passed through to native `copilot` unchanged.

| Flag | Description |
|------|-------------|
| `--f6n-store-session` | Internal hook mode — captures the latest Copilot session |
| `--f6n-show-usage` | Print stored usage from local state |
| `--f6n-state-home <path>` | Override wrapper state directory |
| `--f6n-copilot-home <path>` | Override Copilot state directory |

## Viewing usage reports

Pair with [`@f6n/cli-usage`](../cli-usage) for full usage reports across Codex and Copilot:

```bash
bunx @f6n/cli-usage
```

## Debug log

The session-end hook appends diagnostic entries to `<f6n-copilot-usage-home>/hook-debug.jsonl` (default: `~/.f6n-copilot-usage/hook-debug.jsonl`).

Each line is JSON with a `stage` field for tracing capture: hook invoked → latest session detection → parse counts → summary append → stored usage read.

## Build from source

```bash
npm install
npm run build -w apps/copilot-usage
node apps/copilot-usage/dist/cli.js [copilot args...]
```

## License

Part of the [f6n.run](https://f6n.run) monorepo.
