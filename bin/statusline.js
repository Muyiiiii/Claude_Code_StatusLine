#!/usr/bin/env node
// Claude Code 自定义状态栏 (跨平台 Node.js 版本)

const { execSync, spawn } = require("child_process");
const { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, unlinkSync } = require("fs");
const path = require("path");
const os = require("os");

// ── Colors (ANSI) ──
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const LBLUE = "\x1b[94m";
const DIM = "\x1b[2m";
const RST = "\x1b[0m";

// ── Read JSON from stdin ──
let raw = "";
try {
  raw = readFileSync(0, "utf-8");
} catch {}

let data = {};
try {
  data = JSON.parse(raw);
} catch {}

function get(obj, keyPath, fallback) {
  const keys = keyPath.split(".");
  let val = obj;
  for (const k of keys) {
    if (val == null) return fallback;
    val = val[k];
  }
  return val == null ? fallback : val;
}

// ── Parse CC JSON ──
const modelId = get(data, "model.id", "");
const dir = get(data, "workspace.current_dir", ".");
const dirName = path.basename(dir);

const inputTokens = Number(get(data, "context_window.total_input_tokens", 0));
const outputTokens = Number(get(data, "context_window.total_output_tokens", 0));
let ctxPct = Math.floor(Number(get(data, "context_window.used_percentage", 0)));

const fiveH = Math.floor(Number(get(data, "rate_limits.five_hour.used_percentage", 0)));
const sevenD = Math.floor(Number(get(data, "rate_limits.seven_day.used_percentage", 0)));
const fiveHReset = Number(get(data, "rate_limits.five_hour.resets_at", 0));
const sevenDReset = Number(get(data, "rate_limits.seven_day.resets_at", 0));

const sessionCost = Number(get(data, "cost.total_cost_usd", 0));
const linesAdd = Number(get(data, "cost.total_lines_added", 0));
const linesDel = Number(get(data, "cost.total_lines_removed", 0));

// ── Model display name ──
let modelVer;
if (/opus-4-7/.test(modelId)) modelVer = "Opus 4.7";
else if (/opus-4-6|opus-4-2/.test(modelId)) modelVer = "Opus 4.6";
else if (/sonnet-4-6|sonnet-4-2/.test(modelId)) modelVer = "Sonnet 4.6";
else if (/haiku/.test(modelId)) modelVer = "Haiku 4.5";
else modelVer = get(data, "model.display_name", "Claude");

// ── Effort level (from ~/.claude/settings.json) ──
let effort = "";
try {
  const s = JSON.parse(readFileSync(path.join(os.homedir(), ".claude", "settings.json"), "utf-8"));
  const raw = (s.effortLevel || "").toLowerCase();
  const map = { xhigh: "xHigh", high: "High", medium: "Medium", low: "Low" };
  effort = map[raw] || "";
} catch {}

// ── Git info ──
let branch = "";
try {
  execSync("git rev-parse --git-dir", { stdio: "ignore" });
  branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim() || "detached";
} catch {}

// ── Helpers ──
function fmtTokens(t) {
  if (t >= 1_000_000) return (t / 1_000_000).toFixed(1) + "M";
  if (t >= 1_000) return Math.round(t / 1_000) + "k";
  return String(t);
}

function fmtCost(v) {
  return "$" + Number(v).toFixed(2);
}

function fmtReset(epoch) {
  if (!epoch) return "";
  const diff = epoch - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "now";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d >= 1) return `${d}d${h}h`;
  if (h >= 1) return `${h}h${m}m`;
  return `${m}m`;
}

function makeBar(pct, w = 8) {
  pct = Math.max(0, Math.min(100, pct || 0));
  const filled = Math.round((pct * w) / 100);
  const empty = w - filled;
  return GREEN + "█".repeat(filled) + RST + DIM + "░".repeat(empty) + RST;
}

// ── ccusage cache (non-blocking) ──
const CACHE_DIR = process.platform === "win32"
  ? path.join(os.tmpdir(), "ccusage_cache")
  : "/tmp/ccusage_cache";
const CACHE_FILE = path.join(CACHE_DIR, "daily.json");
const CACHE_LOCK = path.join(CACHE_DIR, "daily.lock");
const CACHE_TTL = 300; // seconds
const LOCK_TTL = 60;   // seconds

mkdirSync(CACHE_DIR, { recursive: true });

let cacheAge = 999999;
try {
  const st = statSync(CACHE_FILE);
  cacheAge = Math.floor((Date.now() - st.mtimeMs) / 1000);
} catch {}

// Auto-remove stale lock file (e.g. left behind by a crashed process)
try {
  const lockSt = statSync(CACHE_LOCK);
  const lockAge = Math.floor((Date.now() - lockSt.mtimeMs) / 1000);
  if (lockAge > LOCK_TTL) unlinkSync(CACHE_LOCK);
} catch {}

if (cacheAge > CACHE_TTL && !existsSync(CACHE_LOCK)) {
  let runner = "npx";
  try { execSync("bun --version", { stdio: "ignore" }); runner = "bunx"; } catch {}

  const d = new Date();
  const monthStart = d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, "0") + "01";
  const tmpFile = CACHE_FILE + ".tmp";

  // Non-blocking: spawn in background, write to tmp then atomic rename
  writeFileSync(CACHE_LOCK, "");
  const cmd = `${runner} ccusage@latest daily --json --since ${monthStart} > "${tmpFile}" 2>/dev/null && mv "${tmpFile}" "${CACHE_FILE}"; rm -f "${CACHE_LOCK}"`;
  const child = spawn("sh", ["-c", cmd], { detached: true, stdio: "ignore" });
  child.unref();
}

// ── Read cached data ──
const today = new Date().toISOString().slice(0, 10);
let todayCost = 0, todayTokens = 0, monthCost = 0, monthTokens = 0;

try {
  const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  const td = (cache.daily || []).find((d) => d.date === today);
  if (td) {
    todayCost = td.totalCost || 0;
    todayTokens = (td.inputTokens || 0) + (td.outputTokens || 0);
  }
  if (cache.totals) {
    monthCost = cache.totals.totalCost || 0;
    monthTokens = (cache.totals.inputTokens || 0) + (cache.totals.outputTokens || 0);
  }
} catch {}

const sessionTokens = inputTokens + outputTokens;

// ── Git files changed ──
let filesChanged = 0;
try {
  const diff1 = execSync("git diff --numstat", { encoding: "utf-8" }).trim();
  const diff2 = execSync("git diff --cached --numstat", { encoding: "utf-8" }).trim();
  filesChanged = (diff1 ? diff1.split("\n").length : 0) + (diff2 ? diff2.split("\n").length : 0);
} catch {}

// ── Output ──
const effortTag = effort ? `${CYAN}·${effort}${RST}` : "";
const fiveHTag = fiveHReset ? ` ${LBLUE}(${fmtReset(fiveHReset)})${RST}` : "";
const sevenDTag = sevenDReset ? ` ${LBLUE}(${fmtReset(sevenDReset)})${RST}` : "";

const L1 = `${CYAN}[${modelVer}${RST}${effortTag}${CYAN}]${RST}  ${YELLOW}📁 ${dirName}${RST} | ${GREEN}🌿 ${branch}${RST} | ${GREEN}↑${fmtTokens(inputTokens)}${RST} ${GREEN}↓${fmtTokens(outputTokens)}${RST}`;
const L2 = `5h:${makeBar(fiveH)} ${fiveH}%${fiveHTag} | 7d:${makeBar(sevenD)} ${sevenD}%${sevenDTag} | ctx:${makeBar(ctxPct)} ${ctxPct}%`;
const L3 = `${YELLOW}session:${fmtCost(sessionCost)}(${fmtTokens(sessionTokens)})${RST} | ${YELLOW}today:${fmtCost(todayCost)}(${fmtTokens(todayTokens)})${RST} | ${YELLOW}month:${fmtCost(monthCost)}(${fmtTokens(monthTokens)})${RST}`;
const L4 = `${GREEN}${filesChanged} files +${linesAdd} -${linesDel}${RST}`;

console.log(L1);
console.log(L2);
console.log(L3);
console.log(L4);
