# Claude Code StatusLine

[中文](./README_CN.md)

A custom status line for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that displays model info, token usage, rate limits, cost tracking, and git status — all in real time.

![status line preview](./assets/image.png)

## Features

- **Model Info** — current model name (Opus 4.7 / 4.6, Sonnet 4.6, Haiku 4.5) with effort level (xHigh / High / Medium / Low)
- **Token Usage** — input / output tokens with human-readable formatting (k / M)
- **Rate Limits** — 5-hour and 7-day usage with visual progress bars + reset countdown
- **Context Window** — percentage of context used
- **Cost Tracking** — session / today / month costs via [ccusage](https://github.com/ryoppippi/ccusage)
- **Git Status** — current branch, files changed, lines added/removed
- **Cross-Platform** — bash version for macOS/Linux, Node.js version for all platforms including Windows

## Quick Start

### Option A: Bash (macOS / Linux)

```bash
bash <(curl -sL https://raw.githubusercontent.com/Muyiiiii/Claude_Code_StatusLine/main/install-statusline.sh)
```

Or clone and run:

```bash
git clone https://github.com/Muyiiiii/Claude_Code_StatusLine.git
cd Claude_Code_StatusLine
bash install-statusline.sh
```

**Dependencies:** `git`, `jq`, `bun` or `npx`

### Option B: Node.js (macOS / Linux / Windows)

```bash
npx claude-code-statusline
```

Or clone and run:

```bash
git clone https://github.com/Muyiiiii/Claude_Code_StatusLine.git
cd Claude_Code_StatusLine
node bin/install.js
```

**Dependencies:** `git`, `node` (v14+), `bun` or `npx` (optional, for ccusage cost tracking)

## What it does

The installer performs two steps:

1. **Copies the statusline script** to `~/.claude/statusline.sh` (bash) or `~/.claude/statusline.js` (Node.js)
2. **Configures `~/.claude/settings.json`** to use the script:

Bash version:
```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 1
  }
}
```

Node.js version:
```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline.js",
    "padding": 1
  }
}
```

After installation, restart Claude Code to see the new status line.

## Display Layout

```
[Opus 4.7·xHigh]  📁 my-project | 🌿 main | ↑125k ↓9k
5h:█░░░░░░░ 12% (2h15m) | 7d:░░░░░░░░ 3% (6d2h) | ctx:██░░░░░░ 35%
session:$0.42(134k) | today:$3.21(1.2M) | month:$28.50(15.6M)
3 files +156 -23
```

| Row | Content |
|-----|---------|
| 1 | Model name + effort, project dir, git branch, input/output tokens |
| 2 | 5-hour / 7-day rate limit bars with reset countdown, context window usage |
| 3 | Session / today / month cost and token totals |
| 4 | Git files changed, lines added/removed |

The effort level is read from `~/.claude/settings.json` (`effortLevel` field, set via Claude Code's `/model` menu).

## Cost Tracking

Monthly and daily cost data is fetched via [ccusage](https://github.com/ryoppippi/ccusage) in the background. The cache is stored at `/tmp/ccusage_cache/daily.json` (or `%TEMP%\ccusage_cache\daily.json` on Windows) and refreshes every 5 minutes.

If `ccusage` is not available or has no data, cost fields will show `$0.00`.

## Uninstall

Remove the statusline script and config:

```bash
rm -f ~/.claude/statusline.sh ~/.claude/statusline.js
```

Then remove the `"statusLine"` key from `~/.claude/settings.json`, or delete the file if it only contains that key.

## Project Structure

```
├── install-statusline.sh   # Bash installer (macOS / Linux)
├── bin/
│   ├── install.js          # Node.js cross-platform installer
│   └── statusline.js       # Node.js statusline script
├── package.json            # npm package config
└── README.md
```

## License

MIT
