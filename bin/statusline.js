#!/usr/bin/env node
// Claude Code 自定义状态栏 (跨平台 Node.js 版本)

"use strict";

const { execFileSync, spawn } = require("child_process");
const {
  accessSync,
  chmodSync,
  closeSync,
  constants: fsConstants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require("fs");
const crypto = require("crypto");
const path = require("path");
const os = require("os");

// ── Colors (ANSI) ──
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const LBLUE = "\x1b[94m";
// Use the terminal's foreground color for body text so it remains readable on
// both light and dark themes. Bright white (97) disappears on light themes.
const TEXT = "\x1b[39m";
const GREY = "\x1b[90m";
const RST = "\x1b[0m";

const CCUSAGE_VERSION = "20.0.17";
const CACHE_TTL = 300; // seconds
const LOCK_TTL = 10 * 60; // npx cold starts can take longer than one minute
const RUNNER_RETRY_TTL = 60 * 60;
const REFRESH_TIMEOUT = 2 * 60 * 1000;
const GIT_TIMEOUT = 1500;
const INTERNAL_REFRESH_ARG = "--muyi-refresh-ccusage";
const MAX_CACHE_BYTES = 20 * 1024 * 1024;

function get(obj, keyPath, fallback) {
  const keys = keyPath.split(".");
  let value = obj;
  for (const key of keys) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.prototype.hasOwnProperty.call(value, key)
    ) {
      return fallback;
    }
    value = value[key];
  }
  return value === null || value === undefined ? fallback : value;
}

function inputString(value, fallback, maxLength) {
  if (typeof value !== "string" || value.indexOf("\0") !== -1) return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return fallback;
  return trimmed;
}

function displayText(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > maxLength
    ? cleaned.slice(0, Math.max(0, maxLength - 3)) + "..."
    : cleaned;
}

function finiteNumber(value, options) {
  const settings = options || {};
  let number;
  if (typeof value === "number") {
    number = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    number = Number(value);
  } else {
    return settings.fallback === undefined ? 0 : settings.fallback;
  }
  if (!Number.isFinite(number)) return settings.fallback === undefined ? 0 : settings.fallback;
  if (settings.integer) number = Math.floor(number);
  if (settings.min !== undefined) number = Math.max(settings.min, number);
  if (settings.max !== undefined) number = Math.min(settings.max, number);
  return number;
}

function percentage(value) {
  return finiteNumber(value, { fallback: 0, integer: true, min: 0, max: 100 });
}

function countValue(value) {
  return finiteNumber(value, {
    fallback: 0,
    integer: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  });
}

function costValue(value) {
  return finiteNumber(value, { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER });
}

function resetValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 128 ? trimmed : 0;
}

function resolveWorkspaceDir(value) {
  const rawDir = inputString(value, "", 4096);
  if (!rawDir) return null;
  try {
    const resolved = path.resolve(rawDir);
    return statSync(resolved).isDirectory() ? resolved : null;
  } catch (_) {
    return null;
  }
}

function directoryName(value, resolvedDir) {
  const rawDir = inputString(value, "", 4096);
  const candidate = resolvedDir || rawDir;
  if (!candidate) return "?";
  try {
    const base = path.basename(candidate) || path.parse(candidate).root || candidate;
    return displayText(base, "?", 30);
  } catch (_) {
    return "?";
  }
}

function normalizeEffort(value, allowMax) {
  if (typeof value !== "string") return "";
  const map = { max: "Max", xhigh: "xHigh", high: "High", medium: "Medium", low: "Low" };
  const key = value.trim().toLowerCase();
  if (key === "max" && allowMax !== true) return "";
  return map[key] || "";
}

function readEffort(data) {
  // The per-request status input can report max; persisted settings officially
  // support only low/medium/high/xhigh.
  let effort = normalizeEffort(get(data, "effort.level", ""), true);
  if (effort) return effort;
  try {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    effort = normalizeEffort(
      settings && typeof settings === "object" && !Array.isArray(settings)
        ? settings.effortLevel
        : "",
      false
    );
  } catch (_) {}
  return effort;
}

function fmtTokens(value) {
  const tokens = countValue(value);
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + "M";
  if (tokens >= 1000) return Math.round(tokens / 1000) + "k";
  return String(tokens);
}

function fmtCost(value) {
  return "$" + costValue(value).toFixed(2);
}

function fmtReset(value) {
  const safeValue = resetValue(value);
  if (safeValue === 0 || safeValue === "0") return "";
  let epoch;
  if (typeof safeValue === "number") {
    epoch = Math.floor(safeValue);
  } else if (/^[0-9]+(\.[0-9]+)?$/.test(safeValue)) {
    epoch = Math.floor(Number(safeValue));
  } else {
    const parsed = Date.parse(safeValue);
    if (!Number.isFinite(parsed)) return "";
    epoch = Math.floor(parsed / 1000);
  }
  if (!Number.isFinite(epoch) || epoch <= 0) return "";
  const diff = epoch - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "now";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days >= 1) return `${days}d${hours}h`;
  if (hours >= 1) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

function makeBar(value, width) {
  const pct = percentage(value);
  const safeWidth = finiteNumber(width, { fallback: 8, integer: true, min: 1, max: 40 });
  const filled = Math.round((pct * safeWidth) / 100);
  return (
    GREEN +
    "█".repeat(filled) +
    RST +
    GREY +
    "░".repeat(safeWidth - filled) +
    RST
  );
}

function gitExec(args, cwd) {
  if (!cwd) throw new Error("A validated workspace directory is required");
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: GIT_TIMEOUT,
    maxBuffer: 512 * 1024,
    windowsHide: true,
  });
}

function countPorcelainEntries(output) {
  if (typeof output !== "string" || !output) return 0;
  const records = output.split("\0");
  let count = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 3) continue;
    count += 1;
    const x = record.charAt(0);
    const y = record.charAt(1);
    // In porcelain -z output a rename/copy has one extra NUL-delimited source path.
    if (x === "R" || x === "C" || y === "R" || y === "C") index += 1;
  }
  return count;
}

function readGitInfo(workspaceDir) {
  const info = { branch: "", filesChanged: 0 };
  if (!workspaceDir) return info;
  try {
    if (gitExec(["rev-parse", "--is-inside-work-tree"], workspaceDir).trim() !== "true") {
      return info;
    }
  } catch (_) {
    return info;
  }

  try {
    info.branch = gitExec(["branch", "--show-current"], workspaceDir).trim();
    if (!info.branch) {
      let shortHash = "";
      try {
        shortHash = gitExec(["rev-parse", "--short=12", "HEAD"], workspaceDir).trim();
      } catch (_) {}
      info.branch = shortHash ? `detached@${shortHash}` : "detached";
    }
    info.branch = displayText(info.branch, "", 80);
  } catch (_) {}

  try {
    const status = gitExec(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      workspaceDir
    );
    info.filesChanged = countPorcelainEntries(status);
  } catch (_) {}
  return info;
}

function localDate(date) {
  const value = date instanceof Date ? date : new Date();
  if (!Number.isFinite(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localMonthStart(date) {
  const value = date instanceof Date ? date : new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return `${year}${month}01`;
}

function cacheUserKey() {
  if (typeof process.getuid === "function") {
    const uid = process.getuid();
    if (Number.isInteger(uid) && uid >= 0) return `uid-${uid}`;
  }
  let identity = "unknown";
  try {
    const user = os.userInfo();
    identity = `${user.username || ""}\0${user.uid || ""}\0${os.homedir()}`;
  } catch (_) {
    try {
      identity = os.homedir();
    } catch (_) {}
  }
  const digest = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return `user-${digest}`;
}

function getCachePaths() {
  const directory = path.join(os.tmpdir(), `muyi-code-statusline-${cacheUserKey()}`);
  return {
    directory,
    cache: path.join(directory, "daily.json"),
    lock: path.join(directory, "daily.lock"),
    runnerMiss: path.join(directory, "runner-unavailable"),
  };
}

function ensureCacheDirectory(paths) {
  try {
    mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
    const status = lstatSync(paths.directory);
    if (!status.isDirectory() || status.isSymbolicLink()) return false;
    try {
      chmodSync(paths.directory, 0o700);
    } catch (_) {
      if (process.platform !== "win32") return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function ageSeconds(filePath) {
  try {
    const age = Math.floor((Date.now() - statSync(filePath).mtimeMs) / 1000);
    return Math.max(0, age);
  } catch (_) {
    return Number.POSITIVE_INFINITY;
  }
}

function randomToken() {
  try {
    return crypto.randomBytes(16).toString("hex");
  } catch (_) {
    return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function removeStaleLock(paths) {
  try {
    const first = statSync(paths.lock);
    if (Math.max(0, (Date.now() - first.mtimeMs) / 1000) <= LOCK_TTL) return;
    const current = statSync(paths.lock);
    const sameFile =
      first.dev === current.dev &&
      first.ino === current.ino &&
      first.size === current.size &&
      first.mtimeMs === current.mtimeMs;
    if (sameFile && Math.max(0, (Date.now() - current.mtimeMs) / 1000) > LOCK_TTL) {
      unlinkSync(paths.lock);
    }
  } catch (_) {}
}

function acquireCacheLock(paths) {
  removeStaleLock(paths);
  const token = randomToken();
  let descriptor;
  try {
    descriptor = openSync(paths.lock, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify({ token, createdAt: Date.now() }) + "\n", "utf-8");
    closeSync(descriptor);
    return token;
  } catch (_) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch (_) {}
      try {
        unlinkSync(paths.lock);
      } catch (_) {}
    }
    return "";
  }
}

function releaseCacheLock(paths, token) {
  if (!token) return;
  try {
    const lock = JSON.parse(readFileSync(paths.lock, "utf-8"));
    if (lock && lock.token === token) unlinkSync(paths.lock);
  } catch (_) {}
}

function executableNames(kind) {
  if (kind === "bunx") {
    // bun ships a native executable on Windows, so no command shell is needed.
    return process.platform === "win32" ? ["bunx.exe", "bunx"] : ["bunx"];
  }
  if (kind === "npx") {
    return process.platform === "win32" ? ["npx.exe", "npx.cmd", "npx"] : ["npx"];
  }
  return [];
}

function findExecutable(kind) {
  const names = executableNames(kind);
  const pathValue = typeof process.env.PATH === "string" ? process.env.PATH : "";
  const directories = pathValue.split(path.delimiter).filter(Boolean);
  for (const rawDirectory of directories) {
    const directory = rawDirectory.replace(/^"|"$/g, "");
    for (const name of names) {
      const candidate = path.resolve(directory, name);
      try {
        const status = statSync(candidate);
        if (!status.isFile()) continue;
        accessSync(candidate, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
        return candidate;
      } catch (_) {}
    }
  }
  return "";
}

function findRunner() {
  const bunx = findExecutable("bunx");
  if (bunx) return { kind: "bunx", command: bunx };
  const npx = findExecutable("npx");
  if (npx) return { kind: "npx", command: npx };
  return null;
}

function markRunnerUnavailable(paths) {
  try {
    writeFileSync(paths.runnerMiss, String(Date.now()) + "\n", { mode: 0o600 });
  } catch (_) {}
}

function clearRunnerUnavailable(paths) {
  try {
    unlinkSync(paths.runnerMiss);
  } catch (_) {}
}

function runnerCommandIsValid(kind, command) {
  if (typeof command !== "string" || command.indexOf("\0") !== -1) return false;
  return executableNames(kind).map((name) => name.toLowerCase()).indexOf(path.basename(command).toLowerCase()) !== -1;
}

function runnerLaunch(kind, command) {
  if (!runnerCommandIsValid(kind, command)) return null;
  if (process.platform !== "win32" || path.extname(command).toLowerCase() !== ".cmd") {
    return { command, prefixArguments: [] };
  }
  // .cmd cannot be executed without cmd.exe. Standard npm installs put the JS
  // entry point beside the shim; launch it with Node to remain shell-free.
  if (kind !== "npx") return null;
  const cli = path.join(path.dirname(command), "node_modules", "npm", "bin", "npx-cli.js");
  try {
    if (!statSync(cli).isFile()) return null;
    return { command: process.execPath, prefixArguments: [cli] };
  } catch (_) {
    return null;
  }
}

function runnerArguments(kind, monthStart) {
  const packageName = `ccusage@${CCUSAGE_VERSION}`;
  // ccusage v20 defaults to every detected coding agent; scope this Claude
  // status line explicitly so usage from other agents is never mixed into totals.
  const common = [packageName, "claude", "daily", "--json", "--since", monthStart];
  return kind === "npx" ? ["--yes"].concat(common) : common;
}

function uniqueTempFile(paths) {
  return path.join(paths.directory, `daily.${process.pid}.${Date.now()}.${randomToken()}.tmp`);
}

function runRunner(command, args, outputDescriptor) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let timer;
    let forceTimer;
    let timedOut = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      resolve(success);
    };
    try {
      child = spawn(command, args, {
        detached: false,
        shell: false,
        stdio: ["ignore", outputDescriptor, "ignore"],
        windowsHide: true,
      });
    } catch (_) {
      finish(false);
      return;
    }
    child.once("error", () => finish(false));
    child.once("exit", (code, signal) => finish(!timedOut && code === 0 && signal === null));
    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      // Normally exit follows immediately. Keep a bounded fallback for unusual
      // platform/process states before the worker cleans its temp file and lock.
      forceTimer = setTimeout(() => finish(false), 5000);
    }, REFRESH_TIMEOUT);
  });
}

async function refreshCacheWorker(kind, command, token) {
  let paths;
  try {
    paths = getCachePaths();
  } catch (_) {
    return false;
  }
  let tempFile = "";
  let descriptor;
  let cacheReady = false;
  try {
    const launch = runnerLaunch(kind, command);
    if (!ensureCacheDirectory(paths)) return false;
    cacheReady = true;
    if (!launch) {
      markRunnerUnavailable(paths);
      return false;
    }
    const lock = JSON.parse(readFileSync(paths.lock, "utf-8"));
    if (!lock || lock.token !== token) return false;

    tempFile = uniqueTempFile(paths);
    descriptor = openSync(tempFile, "wx", 0o600);
    const args = launch.prefixArguments.concat(runnerArguments(kind, localMonthStart()));
    const succeeded = await runRunner(launch.command, args, descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (!succeeded) {
      markRunnerUnavailable(paths);
      return false;
    }

    const status = statSync(tempFile);
    if (!status.isFile() || status.size <= 0 || status.size > MAX_CACHE_BYTES) {
      markRunnerUnavailable(paths);
      return false;
    }
    const parsed = JSON.parse(readFileSync(tempFile, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      markRunnerUnavailable(paths);
      return false;
    }
    renameSync(tempFile, paths.cache);
    tempFile = "";
    clearRunnerUnavailable(paths);
    try {
      chmodSync(paths.cache, 0o600);
    } catch (_) {}
    return true;
  } catch (_) {
    if (cacheReady) {
      try {
        markRunnerUnavailable(paths);
      } catch (_) {}
    }
    return false;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch (_) {}
    }
    if (tempFile) {
      try {
        unlinkSync(tempFile);
      } catch (_) {}
    }
    releaseCacheLock(paths, token);
  }
}

function startCacheRefresh(paths) {
  try {
    if (!ensureCacheDirectory(paths) || ageSeconds(paths.cache) <= CACHE_TTL) return;
    if (ageSeconds(paths.runnerMiss) <= RUNNER_RETRY_TTL) return;

    const token = acquireCacheLock(paths);
    if (!token) return;
    const runner = findRunner();
    if (!runner) {
      markRunnerUnavailable(paths);
      releaseCacheLock(paths, token);
      return;
    }
    clearRunnerUnavailable(paths);
    try {
      const child = spawn(
        process.execPath,
        [__filename, INTERNAL_REFRESH_ARG, runner.kind, runner.command, token],
        { detached: true, stdio: "ignore", windowsHide: true, shell: false }
      );
      child.once("error", () => releaseCacheLock(paths, token));
      child.unref();
    } catch (_) {
      releaseCacheLock(paths, token);
    }
  } catch (_) {
    // Cost data is optional; cache failures must never take down the status line.
  }
}

function emptyUsage() {
  return { todayCost: 0, todayTokens: 0, monthCost: 0, monthTokens: 0 };
}

function readCachedUsage(paths, today) {
  const usage = emptyUsage();
  try {
    const status = statSync(paths.cache);
    if (!status.isFile() || status.size <= 0 || status.size > MAX_CACHE_BYTES) return usage;
    const cache = JSON.parse(readFileSync(paths.cache, "utf-8"));
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) return usage;
    const daily = Array.isArray(cache.daily) ? cache.daily : [];
    const current = daily.find(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry) && entry.date === today
    );
    if (current) {
      usage.todayCost = costValue(current.totalCost);
      usage.todayTokens = countValue(current.inputTokens) + countValue(current.outputTokens);
    }
    const totals = cache.totals;
    if (totals && typeof totals === "object" && !Array.isArray(totals)) {
      usage.monthCost = costValue(totals.totalCost);
      usage.monthTokens = countValue(totals.inputTokens) + countValue(totals.outputTokens);
    }
  } catch (_) {}
  return usage;
}

function parseStdin() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf-8");
  } catch (_) {}
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function hasModelToken(modelId, token) {
  const boundary = /[-._/:@]/;
  let offset = 0;
  while (offset < modelId.length) {
    const index = modelId.indexOf(token, offset);
    if (index === -1) return false;
    const before = index === 0 ? "" : modelId.charAt(index - 1);
    const afterIndex = index + token.length;
    const suffix = modelId.slice(afterIndex);
    const versionSuffix = /^(?:[-._/:@]20\d{6}(?:[-._/:@]v\d+(?::\d+)?)?|[-._/:@]v\d+(?::\d+)?)$/;
    // Permit official dated/provider variants, but do not classify a future
    // sonnet-5-1 (for example) as the known sonnet-5 release.
    if (
      (!before || boundary.test(before)) &&
      (suffix === "" || versionSuffix.test(suffix))
    ) {
      return true;
    }
    offset = index + token.length;
  }
  return false;
}

function modelName(data) {
  const modelId = inputString(get(data, "model.id", ""), "", 200).toLowerCase();
  const knownModels = [
    ["fable-5", "Fable 5"],
    ["mythos-5", "Mythos 5"],
    ["mythos-preview", "Mythos Preview"],
    ["opus-4-8", "Opus 4.8"],
    ["opus-4-7", "Opus 4.7"],
    ["opus-4-6", "Opus 4.6"],
    ["sonnet-5", "Sonnet 5"],
    ["sonnet-4-6", "Sonnet 4.6"],
    ["haiku-4-5", "Haiku 4.5"],
  ];
  for (const mapping of knownModels) {
    if (hasModelToken(modelId, mapping[0])) return mapping[1];
  }
  // Claude Code's display_name is the forward-compatible source for models
  // unknown to this version of the status line.
  return displayText(get(data, "model.display_name", "Claude"), "Claude", 40);
}

function renderStatus(data) {
  const rawWorkspaceDir = get(data, "workspace.current_dir", "");
  const workspaceDir = resolveWorkspaceDir(rawWorkspaceDir);
  const dirName = directoryName(rawWorkspaceDir, workspaceDir);
  const git = readGitInfo(workspaceDir);

  const inputTokens = countValue(get(data, "context_window.total_input_tokens", 0));
  const outputTokens = countValue(get(data, "context_window.total_output_tokens", 0));
  const contextPct = percentage(get(data, "context_window.used_percentage", 0));
  const fiveHour = percentage(get(data, "rate_limits.five_hour.used_percentage", 0));
  const sevenDay = percentage(get(data, "rate_limits.seven_day.used_percentage", 0));
  const fiveHourReset = resetValue(get(data, "rate_limits.five_hour.resets_at", 0));
  const sevenDayReset = resetValue(get(data, "rate_limits.seven_day.resets_at", 0));
  const sessionCost = costValue(get(data, "cost.total_cost_usd", 0));
  const linesAdded = countValue(get(data, "cost.total_lines_added", 0));
  const linesRemoved = countValue(get(data, "cost.total_lines_removed", 0));
  const fastMode = get(data, "fast_mode", false) === true;

  let usage = emptyUsage();
  try {
    const paths = getCachePaths();
    startCacheRefresh(paths);
    usage = readCachedUsage(paths, localDate());
  } catch (_) {}

  const effort = readEffort(data);
  const effortTag = effort ? `${CYAN}·${effort}${RST}` : "";
  const fastTag = fastMode ? "⚡" : "";
  const fiveHourText = fmtReset(fiveHourReset);
  const sevenDayText = fmtReset(sevenDayReset);
  const fiveHourTag = fiveHourText ? ` ${LBLUE}(${fiveHourText})${RST}` : "";
  const sevenDayTag = sevenDayText ? ` ${LBLUE}(${sevenDayText})${RST}` : "";
  const separator = ` ${TEXT}|${RST} `;
  const sessionTokens = inputTokens + outputTokens;

  return [
    `${CYAN}[${RST}${fastTag}${CYAN}${modelName(data)}${RST}${effortTag}${CYAN}]${RST}  ${YELLOW}📁 ${dirName}${RST}${separator}${GREEN}🌿 ${git.branch}${RST}${separator}${GREEN}↑${fmtTokens(inputTokens)}${RST} ${GREEN}↓${fmtTokens(outputTokens)}${RST}`,
    `${TEXT}5h${RST}:${makeBar(fiveHour)} ${TEXT}${fiveHour}%${RST}${fiveHourTag}${separator}${TEXT}7d${RST}:${makeBar(sevenDay)} ${TEXT}${sevenDay}%${RST}${sevenDayTag}${separator}${TEXT}ctx${RST}:${makeBar(contextPct)} ${TEXT}${contextPct}%${RST}`,
    `${YELLOW}session:${fmtCost(sessionCost)}(${fmtTokens(sessionTokens)})${RST}${separator}${YELLOW}today:${fmtCost(usage.todayCost)}(${fmtTokens(usage.todayTokens)})${RST}${separator}${YELLOW}month:${fmtCost(usage.monthCost)}(${fmtTokens(usage.monthTokens)})${RST}`,
    `${GREEN}${git.filesChanged} files +${linesAdded} -${linesRemoved}${RST}`,
  ];
}

function printFallback() {
  console.log(`${CYAN}[${RST}${CYAN}Claude${RST}${CYAN}]${RST}  ${YELLOW}📁 ?${RST}`);
  console.log(`${TEXT}5h${RST}:${makeBar(0)} ${TEXT}0%${RST}`);
  console.log(`${YELLOW}session:$0.00(0)${RST}`);
  console.log(`${GREEN}0 files +0 -0${RST}`);
}

function main() {
  const lines = renderStatus(parseStdin());
  for (const line of lines) console.log(line);
}

if (require.main === module) {
  if (process.argv[2] === INTERNAL_REFRESH_ARG) {
    refreshCacheWorker(process.argv[3], process.argv[4], process.argv[5]).catch(() => {});
  } else {
    try {
      main();
    } catch (_) {
      printFallback();
    }
  }
}

module.exports = {
  countPorcelainEntries,
  finiteNumber,
  getCachePaths,
  localDate,
  modelName,
  normalizeEffort,
  percentage,
  readGitInfo,
  renderStatus,
  resolveWorkspaceDir,
  runnerArguments,
};
