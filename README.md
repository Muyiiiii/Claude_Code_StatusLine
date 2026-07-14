# muyi_code_statusline

[中文](./README_CN.md)

A custom status line for [Claude Code](https://code.claude.com/docs/en/statusline) that displays model info, token usage, rate limits, cost tracking, and Git status in real time.

![status line preview](./assets/image.png)

## Features

- **Model Info** — current Claude models (Fable 5, Opus 4.8, Sonnet 5, Haiku 4.5, and more) with effort level (Max / xHigh / High / Medium / Low)
- **Token Usage** — input / output tokens with human-readable formatting (k / M)
- **Rate Limits** — 5-hour and 7-day usage with visual progress bars + reset countdown
- **Context Window** — percentage of context used
- **Cost Tracking** — session / today / month costs via [ccusage](https://github.com/ccusage/ccusage)
- **Git Status** — current branch, files changed, lines added/removed
- **Cross-Platform** — one-line Bash and PowerShell installers, plus a Node.js installer for every platform

## Quick Start

### macOS / Linux (Bash)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Muyiiiii/muyi_code_statusline/main/install-statusline.sh)
```

Or clone and run:

```bash
git clone https://github.com/Muyiiiii/muyi_code_statusline.git
cd muyi_code_statusline
bash install-statusline.sh
```

**Dependencies:** `git`, `jq`, `bun` or `npx`

### Windows (PowerShell)

Run in PowerShell:

```powershell
powershell.exe -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; Invoke-RestMethod 'https://raw.githubusercontent.com/Muyiiiii/muyi_code_statusline/main/install-statusline.ps1' | Invoke-Expression"
```

The command enables TLS 1.2 in an isolated PowerShell process for compatibility with Windows PowerShell 5.1. The bootstrap downloads `bin/install.js` and `bin/statusline.js` to a unique temporary directory, validates and runs the Node.js installer, and removes the temporary files. The project itself is not installed through npm.

**Dependencies:** `node` (v18+); `git` is optional for Git details, and `bun` or `npx` is optional for ccusage cost tracking.

### Clone and run (macOS / Linux / Windows)

```bash
git clone https://github.com/Muyiiiii/muyi_code_statusline.git
cd muyi_code_statusline
node bin/install.js
```

**Dependencies:** `node` (v18+); `git` is optional for Git details, and `bun` or `npx` is optional for ccusage cost tracking.

## Installation details

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
    "command": "'<absolute-node-path>' '<home>/.claude/statusline.js'",
    "padding": 1
  }
}
```

The Node.js installer records absolute, shell-quoted paths for both Node.js and the statusline script. The exact value is platform- and user-specific.

After installation, restart Claude Code to see the new status line.

## Display Layout

```
[Fable 5·Max]  📁 my-project | 🌿 main | ↑125k ↓9k
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

The effort level is read from the statusline input first, then falls back to `~/.claude/settings.json` (`effortLevel` field, set via Claude Code's `/model` menu).

## Current Claude model and effort support

The known display mappings follow the current [Claude model list](https://platform.claude.com/docs/en/about-claude/models/overview): Fable 5, Mythos 5 / Preview, Opus 4.8 / 4.7 / 4.6, Sonnet 5 / 4.6, and Haiku 4.5. Unknown future models use Claude Code's `model.display_name`, so they still render instead of being mislabeled.

According to the current [Claude Code model configuration](https://code.claude.com/docs/en/model-config), persistent `effortLevel` values are `low`, `medium`, `high`, and `xhigh`. Session-level `max` is shown when Claude Code supplies it in the live status input. For example, these optional preferences can coexist with the installer-managed `statusLine` field:

```json
{
  "model": "best",
  "effortLevel": "high"
}
```

The installer preserves these preferences; it changes only `statusLine`.

## Cost Tracking

Monthly and daily cost data is fetched in the background with the pinned `ccusage@20.0.17` package, scoped specifically to Claude usage. The five-minute cache is kept in a private per-user `muyi-code-statusline-*` directory under the operating system's temporary directory.

If `ccusage` is not available or has no data, cost fields will show `$0.00`.

## Uninstall

Remove the statusline script and config:

```bash
rm -f ~/.claude/statusline.sh ~/.claude/statusline.js
```

On Windows PowerShell:

```powershell
Remove-Item "$HOME\.claude\statusline.js" -Force -ErrorAction SilentlyContinue
```

Then remove the `"statusLine"` key from `~/.claude/settings.json`, or delete the file if it only contains that key.

Installers preserve the previous configuration and script as adjacent `.bak` files when replacing existing files.

## Project Structure

```
├── install-statusline.sh   # Bash installer (macOS / Linux)
├── install-statusline.ps1  # PowerShell bootstrap (Windows)
├── bin/
│   ├── install.js          # Node.js cross-platform installer
│   └── statusline.js       # Node.js statusline script
├── assets/                 # Preview image
├── test/                   # Isolated installer and runtime tests
├── LICENSE                 # MIT license
├── package.json            # Node.js project config
├── README.md               # English documentation
└── README_CN.md            # Chinese documentation
```

## License

[MIT](./LICENSE)
