#!/usr/bin/env node
// Claude Code 状态栏一键安装脚本 (跨平台 Node.js 版本)
// 使用方法: npx claude-code-statusline 或 node bin/install.js

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

const isWin = process.platform === "win32";
const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");

// ── statusline.js 的源文件路径 ──
const STATUSLINE_SRC = path.join(__dirname, "statusline.js");
const STATUSLINE_DEST = path.join(CLAUDE_DIR, "statusline.js");

function log(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

log("🔧 正在安装 Claude Code 自定义状态栏 (Node.js 跨平台版)...");

// ── 检查依赖 ──
function hasBin(name) {
  try {
    execSync(isWin ? `where ${name}` : `command -v ${name}`, { stdio: "ignore" });
    return true;
  } catch { return false; }
}

if (!hasBin("git")) fail("❌ 缺少依赖: git，请先安装");
if (!hasBin("node")) fail("❌ 缺少依赖: node，请先安装");

// 检查 jq（状态栏脚本不依赖 jq，但提示用户）
if (!hasBin("jq")) {
  log("⚠️  未检测到 jq（Node.js 版本不需要 jq，可忽略）");
}

// 检查 bun 或 npx（ccusage 需要）
let runner;
if (hasBin("bun")) runner = "bun";
else if (hasBin("npx")) runner = "npx";
else log("⚠️  未检测到 bun/npx，ccusage 费用统计功能将不可用");

log(`✅ 依赖检查通过${runner ? ` (ccusage 将使用 ${runner})` : ""}`);

// ── 确保 ~/.claude 目录存在 ──
fs.mkdirSync(CLAUDE_DIR, { recursive: true });

// ── 复制 statusline.js ──
try {
  fs.copyFileSync(STATUSLINE_SRC, STATUSLINE_DEST);
} catch {
  // 如果是 npx 运行环境，源文件可能在不同位置；直接从当前脚本同目录拷贝
  const altSrc = path.resolve(__dirname, "statusline.js");
  fs.copyFileSync(altSrc, STATUSLINE_DEST);
}

// 在 Unix 上设置可执行权限
if (!isWin) {
  try { fs.chmodSync(STATUSLINE_DEST, 0o755); } catch {}
}

log(`✅ 状态栏脚本已写入: ${STATUSLINE_DEST}`);

// ── 生成 settings.json 中的命令 ──
// Windows: node "%USERPROFILE%\\.claude\\statusline.js"
// Unix:    node ~/.claude/statusline.js
const statusCmd = isWin
  ? `node "${STATUSLINE_DEST.replace(/\\/g, "\\\\")}"`
  : "node ~/.claude/statusline.js";

// ── 更新 settings.json ──
const statusLineConfig = {
  type: "command",
  command: statusCmd,
  padding: 1,
};

if (fs.existsSync(SETTINGS_PATH)) {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    const existed = !!settings.statusLine;
    settings.statusLine = statusLineConfig;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
    log(existed ? "✅ 已替换 settings.json 中的 statusLine 配置（其他字段保留）" : "✅ 已更新 settings.json");
  } catch (e) {
    fail(`❌ 解析 settings.json 失败: ${e.message}`);
  }
} else {
  const settings = { statusLine: statusLineConfig };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  log("✅ 已创建 settings.json");
}

log("");
log("🎉 安装完成！重启 Claude Code 即可看到新状态栏");
log("   首次启动时 ccusage 费用数据需要几秒钟缓存");
if (isWin) {
  log("   Windows 用户提示: 确保 node 在 PATH 中");
}
