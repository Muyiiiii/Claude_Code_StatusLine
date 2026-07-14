#!/bin/bash
# Claude Code 状态栏一键安装脚本
# 使用方法: curl -fsSL <url> | bash 或直接 bash install-statusline.sh

set -e

CLAUDE_DIR="$HOME/.claude"
SCRIPT_PATH="$CLAUDE_DIR/statusline.sh"
SETTINGS_PATH="$CLAUDE_DIR/settings.json"
SCRIPT_TMP=""
SETTINGS_TMP=""
SCRIPT_EXISTED=0
SCRIPT_INSTALLED=0

cleanup() {
  local status=$?
  set +e
  [[ -n "$SCRIPT_TMP" ]] && rm -f "$SCRIPT_TMP"
  [[ -n "$SETTINGS_TMP" ]] && rm -f "$SETTINGS_TMP"
  if (( status != 0 && SCRIPT_INSTALLED == 1 )); then
    if (( SCRIPT_EXISTED == 1 )) && [[ -f "${SCRIPT_PATH}.bak" ]]; then
      cp -p "${SCRIPT_PATH}.bak" "$SCRIPT_PATH"
    else
      rm -f "$SCRIPT_PATH"
    fi
    echo "⚠️  安装失败，已恢复原状态栏脚本"
  fi
}
trap cleanup EXIT

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
  RUNNER="npx --yes"
else
  echo "❌ 需要 bun 或 npx，请先安装其中之一"
  exit 1
fi
echo "✅ 依赖检查通过 (使用 $RUNNER)"

# 确保 ~/.claude 目录存在
mkdir -p "$CLAUDE_DIR"

# Validate configuration before touching any installed files.
if [[ -f "$SETTINGS_PATH" ]] && ! jq -e 'type == "object"' "$SETTINGS_PATH" >/dev/null 2>&1; then
  echo "❌ $SETTINGS_PATH 不是有效的 JSON 对象，未修改任何文件"
  exit 1
fi

# Keep one rollback copy of files that are about to be replaced.
if [[ -f "$SCRIPT_PATH" ]]; then
  SCRIPT_EXISTED=1
  cp -p "$SCRIPT_PATH" "${SCRIPT_PATH}.bak"
fi
[[ -f "$SETTINGS_PATH" ]] && cp -p "$SETTINGS_PATH" "${SETTINGS_PATH}.bak"

umask 077
SCRIPT_TMP=$(mktemp "$CLAUDE_DIR/statusline.sh.tmp.XXXXXX")

# 写入状态栏脚本
cat > "$SCRIPT_TMP" << 'STATUSLINE'
#!/bin/bash
INPUT=$(cat)
CACHE_DIR="${TMPDIR:-/tmp}/muyi_code_statusline-cache-${UID:-$(id -u)}"
CACHE_READY=0
if [[ ! -L "$CACHE_DIR" ]] && mkdir -p -m 700 "$CACHE_DIR" 2>/dev/null \
  && [[ ! -L "$CACHE_DIR" && -d "$CACHE_DIR" ]]; then
  if chmod 700 "$CACHE_DIR" 2>/dev/null && [[ ! -L "$CACHE_DIR" ]]; then
    CACHE_READY=1
  fi
fi

# ── Colors ──
CYAN=$'\033[36m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
LBLUE=$'\033[94m'
WHITE=$'\033[97m'
GREY=$'\033[90m'
RST=$'\033[0m'

# ── Parse CC JSON (one jq call for all fields) ──
# NUL delimiters keep embedded newlines in untrusted strings from shifting every
# following field. JSON NULs are removed before jq emits the records.
{
  IFS= read -r -d '' MODEL_ID
  IFS= read -r -d '' MODEL_DISPLAY
  IFS= read -r -d '' DIR
  IFS= read -r -d '' INPUT_TOKENS
  IFS= read -r -d '' OUTPUT_TOKENS
  IFS= read -r -d '' CTX_PCT
  IFS= read -r -d '' FIVE_H
  IFS= read -r -d '' SEVEN_D
  IFS= read -r -d '' FIVE_H_RESET
  IFS= read -r -d '' SEVEN_D_RESET
  IFS= read -r -d '' SESSION_COST
  IFS= read -r -d '' LINES_ADD
  IFS= read -r -d '' LINES_DEL
  IFS= read -r -d '' EFFORT_RAW
  IFS= read -r -d '' FAST_MODE
} < <(printf '%s' "$INPUT" | jq -j '
  def text($fallback):
    if type == "string" then gsub("\u0000"; "") else $fallback end;
  def value($path): try getpath($path) catch null;
  def whole:
    if type == "number" then
      floor | if . < 0 then 0 elif . > 9007199254740991 then 9007199254740991 else . end
    else 0 end | tostring;
  def percent:
    if type == "number" then
      floor | if . < 0 then 0 elif . > 100 then 100 else . end
    else 0 end | tostring;
  def decimal:
    if type == "number" then
      if . < 0 then 0 elif . > 9007199254740991 then 9007199254740991 else . end
    else 0 end | tostring;
  def reset:
    if type == "string" then gsub("\u0000"; "")
    elif type == "number" then
      floor | if . < 0 then 0 elif . > 9999999999 then 9999999999 else . end | tostring
    else "0" end;
  (value(["model", "id"]) | text("")), "\u0000",
  (value(["model", "display_name"]) | text("Claude")), "\u0000",
  (value(["workspace", "current_dir"]) | text(".")), "\u0000",
  (value(["context_window", "total_input_tokens"]) | whole), "\u0000",
  (value(["context_window", "total_output_tokens"]) | whole), "\u0000",
  (value(["context_window", "used_percentage"]) | percent), "\u0000",
  (value(["rate_limits", "five_hour", "used_percentage"]) | percent), "\u0000",
  (value(["rate_limits", "seven_day", "used_percentage"]) | percent), "\u0000",
  (value(["rate_limits", "five_hour", "resets_at"]) | reset), "\u0000",
  (value(["rate_limits", "seven_day", "resets_at"]) | reset), "\u0000",
  (value(["cost", "total_cost_usd"]) | decimal), "\u0000",
  (value(["cost", "total_lines_added"]) | whole), "\u0000",
  (value(["cost", "total_lines_removed"]) | whole), "\u0000",
  (value(["effort", "level"]) | text("")), "\u0000",
  (if value(["fast_mode"]) == true then "true" else "false" end), "\u0000"
' 2>/dev/null)

MODEL_DISPLAY=${MODEL_DISPLAY:-Claude}
INPUT_TOKENS=${INPUT_TOKENS:-0}
OUTPUT_TOKENS=${OUTPUT_TOKENS:-0}
CTX_PCT=${CTX_PCT:-0}
FIVE_H=${FIVE_H:-0}
SEVEN_D=${SEVEN_D:-0}
FIVE_H_RESET=${FIVE_H_RESET:-0}
SEVEN_D_RESET=${SEVEN_D_RESET:-0}
SESSION_COST=${SESSION_COST:-0}
LINES_ADD=${LINES_ADD:-0}
LINES_DEL=${LINES_DEL:-0}
EFFORT_RAW=${EFFORT_RAW:-}
FAST_MODE=${FAST_MODE:-false}

# Strip control characters from untrusted display text before writing to the TUI.
sanitize_text() {
  LC_ALL=C printf '%s' "$1" | tr -d '\000-\037\177'
}

MODEL_DISPLAY=$(sanitize_text "$MODEL_DISPLAY")
DIR_NAME=$(sanitize_text "${DIR##*/}")
[[ -z "$DIR_NAME" ]] && DIR_NAME="?"
# Truncate long directory names to keep the layout tidy
if (( ${#DIR_NAME} > 30 )); then
  DIR_NAME="${DIR_NAME:0:27}..."
fi

# ── Model display name ──
# Match exact known releases plus official date/provider suffixes. This avoids
# labeling a future sonnet-5-1 as the older sonnet-5 release.
has_model_version() {
  local id=$1 token=$2 pattern
  pattern="(^|[-._/:@])${token}(\$|[-._/:@]20[0-9]{6}([-._/:@]v[0-9]+(:[0-9]+)?)?\$|[-._/:@]v[0-9]+(:[0-9]+)?\$)"
  [[ "$id" =~ $pattern ]]
}

if has_model_version "$MODEL_ID" "fable-5"; then MODEL_VER="Fable 5"
elif has_model_version "$MODEL_ID" "mythos-5"; then MODEL_VER="Mythos 5"
elif has_model_version "$MODEL_ID" "mythos-preview"; then MODEL_VER="Mythos Preview"
elif has_model_version "$MODEL_ID" "opus-4-8"; then MODEL_VER="Opus 4.8"
elif has_model_version "$MODEL_ID" "opus-4-7"; then MODEL_VER="Opus 4.7"
elif has_model_version "$MODEL_ID" "opus-4-6"; then MODEL_VER="Opus 4.6"
elif has_model_version "$MODEL_ID" "sonnet-5"; then MODEL_VER="Sonnet 5"
elif has_model_version "$MODEL_ID" "sonnet-4-6"; then MODEL_VER="Sonnet 4.6"
elif has_model_version "$MODEL_ID" "haiku-4-5"; then MODEL_VER="Haiku 4.5"
else MODEL_VER="${MODEL_DISPLAY:-Claude}"
fi
if (( ${#MODEL_VER} > 40 )); then
  MODEL_VER="${MODEL_VER:0:37}..."
fi

# ── Effort level (input JSON first, fallback to ~/.claude/settings.json) ──
EFFORT=""
raw=$(echo "$EFFORT_RAW" | tr '[:upper:]' '[:lower:]')
EFFORT_SOURCE="input"
if [[ -z "$raw" ]] && [[ -f "$HOME/.claude/settings.json" ]]; then
  raw=$(jq -r '.effortLevel // ""' "$HOME/.claude/settings.json" 2>/dev/null | tr '[:upper:]' '[:lower:]')
  EFFORT_SOURCE="settings"
fi
case "$raw" in
  max) [[ "$EFFORT_SOURCE" == "input" ]] && EFFORT="Max" ;;
  xhigh) EFFORT="xHigh" ;;
  high) EFFORT="High" ;;
  medium) EFFORT="Medium" ;;
  low) EFFORT="Low" ;;
esac

# ── Git info ──
BRANCH=""
if [[ -n "$DIR" ]] && git -C "$DIR" rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null)
  if [[ -z "$BRANCH" ]]; then
    SHORT=$(git -C "$DIR" rev-parse --short HEAD 2>/dev/null)
    BRANCH="detached@${SHORT:-?}"
  fi
  BRANCH=$(sanitize_text "$BRANCH")
  if (( ${#BRANCH} > 80 )); then
    BRANCH="${BRANCH:0:77}..."
  fi
fi

# ── Helpers ──
fmt_tokens() {
  local t=${1:-0}
  if [[ ! "$t" =~ ^[0-9]+$ ]] || (( ${#t} > 18 )); then
    t=0
  fi
  if (( t >= 1000000 )); then
    local whole=$(( t / 1000000 ))
    local decimal=$(( ((t % 1000000) + 50000) / 100000 ))
    if (( decimal == 10 )); then
      whole=$(( whole + 1 ))
      decimal=0
    fi
    printf "%d.%dM" "$whole" "$decimal"
  elif (( t >= 1000 )); then
    printf "%dk" "$(( (t + 500) / 1000 ))"
  else
    printf "%d" "$t"
  fi
}

fmt_cost() {
  local value=${1:-0}
  if [[ ! "$value" =~ ^[0-9]+([.][0-9]+)?$ ]] || (( ${#value} > 24 )); then
    value=0
  fi
  printf '$%.2f' "$value"
}

fmt_reset() {
  local input=$1
  [ -z "$input" ] || [ "$input" = "0" ] && { echo ""; return; }
  local epoch
  if [[ "$input" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    epoch="${input%%.*}"
    (( ${#epoch} > 10 )) && { echo ""; return; }
  else
    # Fallback: try parsing as ISO 8601
    local s="${input%Z}"
    s="${s%%.*}"
    if [[ "$(uname)" == "Darwin" ]]; then
      epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$s" +%s 2>/dev/null)
    else
      epoch=$(date -u -d "$input" +%s 2>/dev/null)
    fi
    [ -z "$epoch" ] && { echo ""; return; }
  fi
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
  (( pct < 0 )) && pct=0
  (( pct > 100 )) && pct=100
  local filled=$(( (pct * w + 50) / 100 ))
  local empty=$(( w - filled ))
  local bar="${GREEN}"
  for ((i=0; i<filled; i++)); do bar+="█"; done
  bar+="${RST}${GREY}"
  for ((i=0; i<empty; i++)); do bar+="░"; done
  bar+="${RST}"
  printf '%s' "$bar"
}

# ── ccusage cache (non-blocking) ──
CACHE_FILE="$CACHE_DIR/daily.json"
CACHE_LOCK="$CACHE_DIR/daily.lock"
CACHE_FAILURE="$CACHE_DIR/runner-unavailable"
CACHE_TTL=300
RUNNER_RETRY_TTL=3600

now=$(date +%s)
cache_age=999999
if (( CACHE_READY == 1 )) && [[ -f "$CACHE_FILE" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    mtime=$(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0)
  else
    mtime=$(stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0)
  fi
  cache_age=$(( now - mtime ))
fi

failure_age=999999
if (( CACHE_READY == 1 )) && [[ -f "$CACHE_FAILURE" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    failure_mtime=$(stat -f %m "$CACHE_FAILURE" 2>/dev/null || echo 0)
  else
    failure_mtime=$(stat -c %Y "$CACHE_FAILURE" 2>/dev/null || echo 0)
  fi
  failure_age=$(( now - failure_mtime ))
fi

# Auto-remove stale lock file (e.g. left behind by a crashed process)
LOCK_TTL=600
if (( CACHE_READY == 1 )) && [[ -d "$CACHE_LOCK" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    lock_mtime=$(stat -f %m "$CACHE_LOCK" 2>/dev/null || echo 0)
  else
    lock_mtime=$(stat -c %Y "$CACHE_LOCK" 2>/dev/null || echo 0)
  fi
  lock_age=$(( now - lock_mtime ))
  if (( lock_age > LOCK_TTL )); then
    rmdir "$CACHE_LOCK" 2>/dev/null || true
  fi
fi

if (( CACHE_READY == 1 && cache_age > CACHE_TTL && failure_age > RUNNER_RETRY_TTL )) && mkdir "$CACHE_LOCK" 2>/dev/null; then
  (
    MONTH_START=$(date +%Y%m01)
    RUNNER_CMD="__RUNNER__"
    CACHE_TMP="${CACHE_FILE}.tmp.$$"
    if $RUNNER_CMD ccusage@20.0.17 claude daily --json --since "$MONTH_START" > "$CACHE_TMP" 2>/dev/null \
      && jq -e 'type == "object"' "$CACHE_TMP" >/dev/null 2>&1; then
      mv "$CACHE_TMP" "$CACHE_FILE"
      chmod 600 "$CACHE_FILE" 2>/dev/null || true
      rm -f "$CACHE_FAILURE"
    else
      rm -f "$CACHE_TMP"
      printf '%s\n' "$(date +%s)" > "$CACHE_FAILURE"
      chmod 600 "$CACHE_FAILURE" 2>/dev/null || true
    fi
    rmdir "$CACHE_LOCK" 2>/dev/null || true
  ) &
  disown 2>/dev/null || true
fi

TODAY=$(date +%Y-%m-%d)
TODAY_COST="0"; TODAY_TOKENS="0"
MONTH_COST="0"; MONTH_TOKENS="0"

if (( CACHE_READY == 1 )) && [[ -f "$CACHE_FILE" ]]; then
  # Batch ccusage cache reads (one jq call)
  {
    read -r TODAY_COST
    read -r TODAY_TOKENS
    read -r MONTH_COST
    read -r MONTH_TOKENS
  } < <(jq -r --arg d "$TODAY" '
    ((.daily[]? | select(.date == $d) | .totalCost) // 0),
    (((.daily[]? | select(.date == $d) | ((.inputTokens // 0) + (.outputTokens // 0)))) // 0),
    (.totals.totalCost // 0),
    ((.totals.inputTokens // 0) + (.totals.outputTokens // 0))
  ' "$CACHE_FILE" 2>/dev/null)
  [ -z "$TODAY_COST" ] && TODAY_COST=0
  [ -z "$TODAY_TOKENS" ] && TODAY_TOKENS=0
  [ -z "$MONTH_COST" ] && MONTH_COST=0
  [ -z "$MONTH_TOKENS" ] && MONTH_TOKENS=0
fi

SESSION_TOKENS=$(( INPUT_TOKENS + OUTPUT_TOKENS ))

FILES_CHANGED=0
if [[ -n "$DIR" ]] && git -C "$DIR" rev-parse --git-dir >/dev/null 2>&1; then
  FILES_CHANGED=$(git -C "$DIR" status --porcelain --untracked-files=normal 2>/dev/null | wc -l | tr -d ' ')
fi

# ── Output ──
EFFORT_TAG=""
[ -n "$EFFORT" ] && EFFORT_TAG="${CYAN}·${EFFORT}${RST}"
FAST_TAG=""
[ "$FAST_MODE" = "true" ] && FAST_TAG="⚡"
FIVE_H_TAG=""
FIVE_H_TXT=$(fmt_reset "$FIVE_H_RESET")
[ -n "$FIVE_H_TXT" ] && FIVE_H_TAG=" ${LBLUE}(${FIVE_H_TXT})${RST}"
SEVEN_D_TAG=""
SEVEN_D_TXT=$(fmt_reset "$SEVEN_D_RESET")
[ -n "$SEVEN_D_TXT" ] && SEVEN_D_TAG=" ${LBLUE}(${SEVEN_D_TXT})${RST}"

printf '%s\n' "${CYAN}[${RST}${FAST_TAG}${CYAN}${MODEL_VER}${RST}${EFFORT_TAG}${CYAN}]${RST}  ${YELLOW}📁 ${DIR_NAME}${RST} ${WHITE}|${RST} ${GREEN}🌿 ${BRANCH}${RST} ${WHITE}|${RST} ${GREEN}↑$(fmt_tokens "$INPUT_TOKENS")${RST} ${GREEN}↓$(fmt_tokens "$OUTPUT_TOKENS")${RST}"
printf '%s\n' "${WHITE}5h${RST}:$(make_bar "$FIVE_H") ${WHITE}${FIVE_H}%${RST}${FIVE_H_TAG} ${WHITE}|${RST} ${WHITE}7d${RST}:$(make_bar "$SEVEN_D") ${WHITE}${SEVEN_D}%${RST}${SEVEN_D_TAG} ${WHITE}|${RST} ${WHITE}ctx${RST}:$(make_bar "$CTX_PCT") ${WHITE}${CTX_PCT}%${RST}"
printf '%s\n' "${YELLOW}session:$(fmt_cost "$SESSION_COST")($(fmt_tokens "$SESSION_TOKENS"))${RST} ${WHITE}|${RST} ${YELLOW}today:$(fmt_cost "$TODAY_COST")($(fmt_tokens "$TODAY_TOKENS"))${RST} ${WHITE}|${RST} ${YELLOW}month:$(fmt_cost "$MONTH_COST")($(fmt_tokens "$MONTH_TOKENS"))${RST}"
printf '%s\n' "${GREEN}${FILES_CHANGED} files +${LINES_ADD} -${LINES_DEL}${RST}"
STATUSLINE

# 替换 runner 占位符
if ! sed -i.bak "s|__RUNNER__|$RUNNER|g" "$SCRIPT_TMP"; then
  echo "❌ 生成状态栏脚本失败"
  exit 1
fi
rm -f "${SCRIPT_TMP}.bak"
chmod 755 "$SCRIPT_TMP"
mv "$SCRIPT_TMP" "$SCRIPT_PATH"
SCRIPT_TMP=""
SCRIPT_INSTALLED=1
echo "✅ 状态栏脚本已写入: $SCRIPT_PATH"

# 更新 settings.json
if [[ -f "$SETTINGS_PATH" ]]; then
  existed=$(jq -e '.statusLine' "$SETTINGS_PATH" &>/dev/null && echo 1 || echo 0)
  SETTINGS_TMP=$(mktemp "$CLAUDE_DIR/settings.json.tmp.XXXXXX")
  if ! jq '.statusLine = {"type":"command","command":"~/.claude/statusline.sh","padding":1}' \
    "$SETTINGS_PATH" > "$SETTINGS_TMP"; then
    echo "❌ 更新 settings.json 失败；原配置保持不变"
    exit 1
  fi
  if [[ "$(uname)" == "Darwin" ]]; then
    SETTINGS_MODE=$(stat -f %Lp "$SETTINGS_PATH")
  else
    SETTINGS_MODE=$(stat -c %a "$SETTINGS_PATH")
  fi
  chmod "$SETTINGS_MODE" "$SETTINGS_TMP"
  mv "$SETTINGS_TMP" "$SETTINGS_PATH"
  SETTINGS_TMP=""
  if [[ "$existed" == "1" ]]; then
    echo "✅ 已替换 settings.json 中的 statusLine 配置（其他字段保留）"
  else
    echo "✅ 已更新 settings.json"
  fi
else
  # 新建配置文件
  SETTINGS_TMP=$(mktemp "$CLAUDE_DIR/settings.json.tmp.XXXXXX")
  cat > "$SETTINGS_TMP" << 'EOF'
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 1
  }
}
EOF
  chmod 600 "$SETTINGS_TMP"
  mv "$SETTINGS_TMP" "$SETTINGS_PATH"
  SETTINGS_TMP=""
  echo "✅ 已创建 settings.json"
fi

echo ""
echo "🎉 安装完成！重启 Claude Code 即可看到新状态栏"
echo "   首次启动时 ccusage 费用数据需要几秒钟缓存"
