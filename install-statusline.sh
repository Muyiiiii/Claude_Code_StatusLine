#!/bin/bash
# Claude Code 状态栏一键安装脚本
# 使用方法: curl -sL <url> | bash 或直接 bash install-statusline.sh

set -e

CLAUDE_DIR="$HOME/.claude"
SCRIPT_PATH="$CLAUDE_DIR/statusline.sh"
SETTINGS_PATH="$CLAUDE_DIR/settings.json"

echo "🔧 正在安装 Claude Code 自定义状态栏..."

# 检查依赖
check_dep() {
  if ! command -v "$1" &>/dev/null; then
    echo "❌ 缺少依赖: $1，请先安装"
    return 1
  fi
}

check_dep jq || exit 1
check_dep git || exit 1

# 检查 bun 或 npx（ccusage 需要）
if command -v bun &>/dev/null; then
  RUNNER="bunx"
elif command -v npx &>/dev/null; then
  RUNNER="npx"
else
  echo "❌ 需要 bun 或 npx，请先安装其中之一"
  exit 1
fi
echo "✅ 依赖检查通过 (使用 $RUNNER)"

# 确保 ~/.claude 目录存在
mkdir -p "$CLAUDE_DIR"

# 写入状态栏脚本
cat > "$SCRIPT_PATH" << 'STATUSLINE'
#!/bin/bash
INPUT=$(cat)
CACHE_DIR="/tmp/ccusage_cache"
mkdir -p "$CACHE_DIR" 2>/dev/null

# ── Colors ──
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
DIM='\033[2m'
RST='\033[0m'

# ── Parse CC JSON ──
jq_get() { echo "$INPUT" | jq -r "$1 // $2" 2>/dev/null; }

MODEL_ID=$(jq_get '.model.id' '""')
DIR=$(jq_get '.workspace.current_dir' '"."')
DIR_NAME="${DIR##*/}"

INPUT_TOKENS=$(jq_get '.context_window.total_input_tokens' '0')
OUTPUT_TOKENS=$(jq_get '.context_window.total_output_tokens' '0')
CTX_PCT=$(jq_get '.context_window.used_percentage' '0' | cut -d. -f1)
[ -z "$CTX_PCT" ] && CTX_PCT=0

FIVE_H=$(jq_get '.rate_limits.five_hour.used_percentage' '0' | cut -d. -f1)
SEVEN_D=$(jq_get '.rate_limits.seven_day.used_percentage' '0' | cut -d. -f1)
[ -z "$FIVE_H" ] && FIVE_H=0
[ -z "$SEVEN_D" ] && SEVEN_D=0
FIVE_H_RESET=$(jq_get '.rate_limits.five_hour.resets_at' '0')
SEVEN_D_RESET=$(jq_get '.rate_limits.seven_day.resets_at' '0')

SESSION_COST=$(jq_get '.cost.total_cost_usd' '0')
LINES_ADD=$(jq_get '.cost.total_lines_added' '0')
LINES_DEL=$(jq_get '.cost.total_lines_removed' '0')

# ── Model display name ──
case "$MODEL_ID" in
  *opus-4-7*) MODEL_VER="Opus 4.7" ;;
  *opus-4-6*|*opus-4-2*) MODEL_VER="Opus 4.6" ;;
  *sonnet-4-6*|*sonnet-4-2*) MODEL_VER="Sonnet 4.6" ;;
  *haiku*) MODEL_VER="Haiku 4.5" ;;
  *) MODEL_VER=$(jq_get '.model.display_name' '"Claude"') ;;
esac

# ── Effort level (from ~/.claude/settings.json) ──
EFFORT=""
if [[ -f "$HOME/.claude/settings.json" ]]; then
  raw=$(jq -r '.effortLevel // ""' "$HOME/.claude/settings.json" 2>/dev/null)
  case "$raw" in
    xhigh) EFFORT="xHigh" ;;
    high) EFFORT="High" ;;
    medium) EFFORT="Medium" ;;
    low) EFFORT="Low" ;;
  esac
fi

# ── Git info ──
BRANCH=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
fi

# ── Helpers ──
fmt_tokens() {
  local t=$1
  if (( t >= 1000000 )); then
    printf "%.1fM" "$(echo "scale=1; $t/1000000" | bc)"
  elif (( t >= 1000 )); then
    printf "%.0fk" "$(echo "scale=0; $t/1000" | bc)"
  else
    printf "%d" "$t"
  fi
}

fmt_cost() { printf '$%.2f' "$1"; }

fmt_reset() {
  local epoch=$1
  [ -z "$epoch" ] || [ "$epoch" = "0" ] && { echo ""; return; }
  local now=$(date +%s)
  local diff=$(( epoch - now ))
  if (( diff <= 0 )); then echo "now"; return; fi
  local d=$(( diff / 86400 ))
  local h=$(( (diff % 86400) / 3600 ))
  local m=$(( (diff % 3600) / 60 ))
  if (( d >= 1 )); then echo "${d}d${h}h"; return; fi
  if (( h >= 1 )); then echo "${h}h${m}m"; return; fi
  echo "${m}m"
}

make_bar() {
  local pct=${1:-0} w=${2:-8}
  local filled=$(( pct * w / 100 ))
  local empty=$(( w - filled ))
  local bar="${GREEN}"
  for ((i=0; i<filled; i++)); do bar+="█"; done
  bar+="${RST}${DIM}"
  for ((i=0; i<empty; i++)); do bar+="░"; done
  bar+="${RST}"
  echo -ne "$bar"
}

# ── ccusage cache (non-blocking) ──
CACHE_FILE="$CACHE_DIR/daily.json"
CACHE_LOCK="$CACHE_DIR/daily.lock"
CACHE_TTL=300

now=$(date +%s)
cache_age=999999
if [[ -f "$CACHE_FILE" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    mtime=$(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0)
  else
    mtime=$(stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0)
  fi
  cache_age=$(( now - mtime ))
fi

# Auto-remove stale lock file (e.g. left behind by a crashed process)
LOCK_TTL=60
if [[ -f "$CACHE_LOCK" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    lock_mtime=$(stat -f %m "$CACHE_LOCK" 2>/dev/null || echo 0)
  else
    lock_mtime=$(stat -c %Y "$CACHE_LOCK" 2>/dev/null || echo 0)
  fi
  lock_age=$(( now - lock_mtime ))
  if (( lock_age > LOCK_TTL )); then
    rm -f "$CACHE_LOCK"
  fi
fi

if (( cache_age > CACHE_TTL )) && ! [[ -f "$CACHE_LOCK" ]]; then
  (
    touch "$CACHE_LOCK"
    MONTH_START=$(date +%Y%m01)
    RUNNER_CMD="__RUNNER__"
    $RUNNER_CMD ccusage@latest daily --json --since "$MONTH_START" > "${CACHE_FILE}.tmp" 2>/dev/null \
      && mv "${CACHE_FILE}.tmp" "$CACHE_FILE"
    rm -f "$CACHE_LOCK"
  ) &
  disown
fi

TODAY=$(date +%Y-%m-%d)
TODAY_COST="0"; TODAY_TOKENS="0"
MONTH_COST="0"; MONTH_TOKENS="0"

if [[ -f "$CACHE_FILE" ]]; then
  td=$(jq -r --arg d "$TODAY" '.daily[]? | select(.date == $d)' "$CACHE_FILE" 2>/dev/null)
  if [[ -n "$td" ]]; then
    TODAY_COST=$(echo "$td" | jq -r '.totalCost // 0')
    TODAY_TOKENS=$(echo "$td" | jq -r '((.inputTokens // 0) + (.outputTokens // 0))')
  fi
  mt=$(jq -r '.totals // empty' "$CACHE_FILE" 2>/dev/null)
  if [[ -n "$mt" ]]; then
    MONTH_COST=$(echo "$mt" | jq -r '.totalCost // 0')
    MONTH_TOKENS=$(echo "$mt" | jq -r '((.inputTokens // 0) + (.outputTokens // 0))')
  fi
fi

SESSION_TOKENS=$(( INPUT_TOKENS + OUTPUT_TOKENS ))

FILES_CHANGED=0
if git rev-parse --git-dir >/dev/null 2>&1; then
  FILES_CHANGED=$(( $(git diff --numstat 2>/dev/null | wc -l) + $(git diff --cached --numstat 2>/dev/null | wc -l) ))
fi

# ── Output ──
EFFORT_TAG=""
[ -n "$EFFORT" ] && EFFORT_TAG="${CYAN}·${EFFORT}${RST}"
FIVE_H_TAG=""
FIVE_H_TXT=$(fmt_reset "$FIVE_H_RESET")
[ -n "$FIVE_H_TXT" ] && FIVE_H_TAG=" ${DIM}(${FIVE_H_TXT})${RST}"
SEVEN_D_TAG=""
SEVEN_D_TXT=$(fmt_reset "$SEVEN_D_RESET")
[ -n "$SEVEN_D_TXT" ] && SEVEN_D_TAG=" ${DIM}(${SEVEN_D_TXT})${RST}"

echo -e "${CYAN}[${MODEL_VER}${RST}${EFFORT_TAG}${CYAN}]${RST}  📁 ${DIR_NAME} | 🌿 ${BRANCH} | ${GREEN}↑$(fmt_tokens $INPUT_TOKENS)${RST} ${GREEN}↓$(fmt_tokens $OUTPUT_TOKENS)${RST}"
echo -e "5h:$(make_bar $FIVE_H) ${FIVE_H}%${FIVE_H_TAG} | 7d:$(make_bar $SEVEN_D) ${SEVEN_D}%${SEVEN_D_TAG} | ctx:$(make_bar $CTX_PCT) ${CTX_PCT}%"
echo -e "${YELLOW}session:$(fmt_cost $SESSION_COST)($(fmt_tokens $SESSION_TOKENS))${RST} | ${YELLOW}today:$(fmt_cost $TODAY_COST)($(fmt_tokens $TODAY_TOKENS))${RST} | ${YELLOW}month:$(fmt_cost $MONTH_COST)($(fmt_tokens $MONTH_TOKENS))${RST}"
echo -e "${GREEN}${FILES_CHANGED} files +${LINES_ADD} -${LINES_DEL}${RST}"
STATUSLINE

# 替换 runner 占位符
sed -i.bak "s|__RUNNER__|$RUNNER|g" "$SCRIPT_PATH" && rm -f "${SCRIPT_PATH}.bak"
chmod +x "$SCRIPT_PATH"
echo "✅ 状态栏脚本已写入: $SCRIPT_PATH"

# 更新 settings.json
if [[ -f "$SETTINGS_PATH" ]]; then
  existed=$(jq -e '.statusLine' "$SETTINGS_PATH" &>/dev/null && echo 1 || echo 0)
  jq '.statusLine = {"type":"command","command":"~/.claude/statusline.sh","padding":1}' \
    "$SETTINGS_PATH" > "${SETTINGS_PATH}.tmp" && mv "${SETTINGS_PATH}.tmp" "$SETTINGS_PATH"
  if [[ "$existed" == "1" ]]; then
    echo "✅ 已替换 settings.json 中的 statusLine 配置（其他字段保留）"
  else
    echo "✅ 已更新 settings.json"
  fi
else
  # 新建配置文件
  cat > "$SETTINGS_PATH" << 'EOF'
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 1
  }
}
EOF
  echo "✅ 已创建 settings.json"
fi

echo ""
echo "🎉 安装完成！重启 Claude Code 即可看到新状态栏"
echo "   首次启动时 ccusage 费用数据需要几秒钟缓存"
