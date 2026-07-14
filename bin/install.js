#!/usr/bin/env node
// Claude Code 状态栏一键安装脚本（跨平台 Node.js 版本）
// 使用方法: node bin/install.js

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const isWin = process.platform === "win32";
const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const STATUSLINE_DEST = path.join(CLAUDE_DIR, "statusline.js");

function log(message) {
  console.log(message);
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function hasBin(name) {
  const command = isWin ? "where.exe" : "/bin/sh";
  const args = isWin
    ? [name]
    : ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", name];
  const result = spawnSync(command, args, { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fileMode(stat, fallback) {
  return isWin ? fallback : (stat.mode & 0o777);
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return {
      exists: false,
      mode: 0o600,
      raw: null,
      value: {},
    };
  }

  let raw;
  try {
    raw = fs.readFileSync(SETTINGS_PATH, "utf8");
  } catch (error) {
    throw new Error(`无法读取 ${SETTINGS_PATH}: ${error.message}`);
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${SETTINGS_PATH} 不是有效的 JSON: ${error.message}`);
  }

  if (!isPlainObject(value)) {
    throw new Error(`${SETTINGS_PATH} 的顶层必须是 JSON 对象，不能是数组或 null`);
  }

  let stat;
  try {
    stat = fs.statSync(SETTINGS_PATH);
  } catch (error) {
    throw new Error(`无法读取 ${SETTINGS_PATH} 的文件信息: ${error.message}`);
  }

  return {
    exists: true,
    mode: fileMode(stat, 0o600),
    raw,
    value,
  };
}

function readExistingFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, data: null, mode: null };
  }

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      throw new Error("路径不是普通文件");
    }
    return {
      exists: true,
      data: fs.readFileSync(filePath),
      mode: fileMode(stat, 0o644),
    };
  } catch (error) {
    throw new Error(`无法读取 ${filePath}: ${error.message}`);
  }
}

function statuslineSourceCandidates() {
  // Only trust the file shipped beside this installer. Falling back to the
  // caller's working directory could install an unrelated project file.
  return [path.resolve(__dirname, "statusline.js")];
}

function readStatuslineSource() {
  const candidates = statuslineSourceCandidates();
  const errors = [];

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) {
        errors.push(`${candidate}（不是普通文件）`);
        continue;
      }
      return fs.readFileSync(candidate);
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        errors.push(`${candidate}（${error.message}）`);
      }
    }
  }

  const checked = candidates.join("、");
  const detail = errors.length > 0 ? `；${errors.join("；")}` : "";
  throw new Error(`找不到可读取的 statusline.js（已检查: ${checked}${detail}）`);
}

function tempPathFor(targetPath) {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${suffix}.tmp`);
}

// Write beside the destination and rename only after the complete file is durable.
function atomicWriteFile(targetPath, data, mode) {
  const tempPath = tempPathFor(targetPath);
  let descriptor = null;

  try {
    descriptor = fs.openSync(tempPath, "wx", mode);
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;

    if (!isWin) {
      fs.chmodSync(tempPath, mode);
    }
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_) {}
    }
    try { fs.unlinkSync(tempPath); } catch (_) {}
    throw error;
  }
}

function quoteCommandArg(value) {
  const argument = String(value);
  if (isWin) {
    // Windows paths already contain literal backslashes; JSON.stringify will
    // escape them once when settings.json is serialized.
    return `"${argument.replace(/"/g, '""')}"`;
  }
  return `'${argument.replace(/'/g, `'\\''`)}'`;
}

function rollbackStatusline(previous) {
  if (previous.exists) {
    atomicWriteFile(STATUSLINE_DEST, previous.data, previous.mode);
    return "已恢复原状态栏脚本";
  }

  try {
    fs.unlinkSync(STATUSLINE_DEST);
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
  return "已移除本次写入的状态栏脚本";
}

function main() {
  log("🔧 正在安装 Claude Code 自定义状态栏（Node.js 跨平台版）...");

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 18) {
    throw new Error(`需要 Node.js 18 或更高版本，当前版本为 ${process.version}`);
  }

  if (!hasBin("git")) {
    log("⚠️  未检测到 git，状态栏中的 Git 分支信息将不可用");
  }

  let runner = null;
  if (hasBin("bun")) runner = "bunx";
  else if (hasBin("npx")) runner = "npx";
  else log("⚠️  未检测到 bun/npx，ccusage 费用统计功能将不可用");

  log(`✅ 依赖检查通过${runner ? `（ccusage 将使用 ${runner}）` : ""}`);

  // All reads and validation happen before mkdir, backups, or destination writes.
  const settings = readSettings();
  const previousStatusline = readExistingFile(STATUSLINE_DEST);
  const statuslineSource = readStatuslineSource();

  const statusCommand = [process.execPath, STATUSLINE_DEST]
    .map(quoteCommandArg)
    .join(" ");
  const hadStatusLine = Object.prototype.hasOwnProperty.call(settings.value, "statusLine");
  settings.value.statusLine = {
    type: "command",
    command: statusCommand,
    padding: 1,
  };

  let serializedSettings;
  try {
    serializedSettings = `${JSON.stringify(settings.value, null, 2)}\n`;
  } catch (error) {
    throw new Error(`无法生成新的 settings.json: ${error.message}`);
  }

  try {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new Error(`无法创建 ${CLAUDE_DIR}: ${error.message}`);
  }

  if (settings.exists) {
    const backupPath = `${SETTINGS_PATH}.bak`;
    try {
      atomicWriteFile(backupPath, settings.raw, settings.mode);
      log(`✅ 已备份原配置: ${backupPath}`);
    } catch (error) {
      throw new Error(`无法备份 ${SETTINGS_PATH} 到 ${backupPath}: ${error.message}`);
    }
  }

  if (previousStatusline.exists) {
    const backupPath = `${STATUSLINE_DEST}.bak`;
    try {
      atomicWriteFile(backupPath, previousStatusline.data, previousStatusline.mode);
      log(`✅ 已备份原状态栏脚本: ${backupPath}`);
    } catch (error) {
      throw new Error(`无法备份 ${STATUSLINE_DEST} 到 ${backupPath}: ${error.message}`);
    }
  }

  try {
    atomicWriteFile(STATUSLINE_DEST, statuslineSource, isWin ? 0o644 : 0o755);
  } catch (error) {
    throw new Error(`无法写入状态栏脚本 ${STATUSLINE_DEST}: ${error.message}`);
  }
  log(`✅ 状态栏脚本已写入: ${STATUSLINE_DEST}`);

  try {
    atomicWriteFile(SETTINGS_PATH, serializedSettings, settings.mode);
  } catch (error) {
    let rollbackMessage;
    try {
      rollbackMessage = rollbackStatusline(previousStatusline);
    } catch (rollbackError) {
      rollbackMessage = `回滚状态栏脚本也失败了: ${rollbackError.message}`;
    }
    throw new Error(`无法写入 ${SETTINGS_PATH}: ${error.message}（${rollbackMessage}）`);
  }

  log(
    hadStatusLine
      ? "✅ 已替换 settings.json 中的 statusLine 配置（其他字段保留）"
      : settings.exists
        ? "✅ 已更新 settings.json（其他字段保留）"
        : "✅ 已创建 settings.json"
  );

  log("");
  log("🎉 安装完成！重启 Claude Code 即可看到新状态栏");
  log("   首次启动时 ccusage 费用数据需要几秒钟缓存");
}

try {
  main();
} catch (error) {
  fail(error && error.message ? error.message : String(error));
}
