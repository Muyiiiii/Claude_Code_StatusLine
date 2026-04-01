#!/usr/bin/env node
// Claude Code 自定义状态栏 (跨平台 Node.js 版本)

const { execSync } = require("child_process");
const { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, unlinkSync } = require("fs");
const path = require("path");
const os = require("os");

// ── Colors (ANSI) ──
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
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

const sessionCost = Number(get(data, "cost.total_cost_usd", 0));
const linesAdd = Number(get(data, "cost.total_lines_added", 0));
const linesDel = Number(get(data, "cost.total_lines_removed", 0));

// ── Model display name ──
let modelVer;
if (/opus-4-6|opus-4-2/.test(modelId)) modelVer = "Opus 4.6";
else if (/sonnet-4-6|sonnet-4-2/.test(modelId)) modelVer = "Sonnet 4.6";
else if (/haiku/.test(modelId)) modelVer = "Haiku 4.5";
else modelVer = get(data, "model.display_name", "Claude");

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

function makeBar(pct, w = 12) {
  pct = Math.max(0, Math.min(100, pct || 0));
  const filled = Math.round((pct * w) / 100);
  const empty = w - filled;
  return GREEN + "█".repeat(filled) + RST + DIM + "░".repeat(empty) + RST;
}

// ── ccusage cache (non-blocking) ──
const CACHE_DIR = path.join(os.tmpdir(), "ccusage_cache");
const CACHE_FILE = path.join(CACHE_DIR, "daily.json");
const CACHE_LOCK = path.join(CACHE_DIR, "daily.lock");
const CACHE_TTL = 300; // seconds

mkdirSync(CACHE_DIR, { recursive: true });

let cacheAge = 999999;
try {
  const st = statSync(CACHE_FILE);
  cacheAge = Math.floor((Date.now() - st.mtimeMs) / 1000);
} catch {}

// Auto-remove stale lock file (e.g. left behind by a crashed process)
const LOCK_TTL = 60; // seconds
try {
  const lockSt = statSync(CACHE_LOCK);
  const lockAge = Math.floor((Date.now() - lockSt.mtimeMs) / 1000);
  if (lockAge > LOCK_TTL) unlinkSync(CACHE_LOCK);
} catch {}

if (cacheAge > CACHE_TTL && !existsSync(CACHE_LOCK)) {
  // Determine runner
  let runner = "npx";
  try { execSync("bun --version", { stdio: "ignore" }); runner = "bunx"; } catch {}

  const monthStart = new Date().toISOString().slice(0, 8) + "01";
  const cmd = `${runner} ccusage@latest daily --json --offline --since ${monthStart}`;

  try {
    writeFileSync(CACHE_LOCK, "");
    const { spawn } = require("child_process");
    const isWin = process.platform === "win32";
    const child = spawn(isWin ? "cmd" : "sh", isWin ? ["/c", cmd] : ["-c", cmd], {
      stdio: ["ignore", "pipe", "ignore"],
      detached: !isWin,
    });

    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", (code) => {
      if (code === 0 && out.trim()) {
        try { writeFileSync(CACHE_FILE, out); } catch {}
      }
      try { unlinkSync(CACHE_LOCK); } catch {}
    });
    child.unref();
  } catch {
    try { unlinkSync(CACHE_LOCK); } catch {}
  }
}

// ── Read cached data ──
const today = new Date().toISOString().slice(0, 10);
let todayCost = 0, todayTokens = 0, monthCost = 0, monthTokens = 0;

try {
  const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  const td = (cache.daily || []).find((d) => d.date === today);
  if (td) {
    todayCost = td.totalCost || 0;
    todayTokens = td.totalTokens || 0;
  }
  if (cache.totals) {
    monthCost = cache.totals.totalCost || 0;
    monthTokens = cache.totals.totalTokens || 0;
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
const L1 = `${CYAN}[${modelVer}]${RST}  📁 ${dirName} | 🌿 ${branch} | ${GREEN}↑${fmtTokens(inputTokens)}${RST} ${GREEN}↓${fmtTokens(outputTokens)}${RST}`;
const L2 = `5h:${makeBar(fiveH)} ${fiveH}% | 7d:${makeBar(sevenD)} ${sevenD}% | ctx:${makeBar(ctxPct)} ${ctxPct}%`;
const L3 = `${YELLOW}session:${fmtCost(sessionCost)}(${fmtTokens(sessionTokens)})${RST} | ${YELLOW}today:${fmtCost(todayCost)}(${fmtTokens(todayTokens)})${RST} | ${YELLOW}month:${fmtCost(monthCost)}(${fmtTokens(monthTokens)})${RST}`;
const L4 = `${GREEN}${filesChanged} files +${linesAdd} -${linesDel}${RST}`;

console.log(L1);
console.log(L2);
console.log(L3);
console.log(L4);
