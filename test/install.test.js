#!/usr/bin/env node

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const INSTALLER = path.join(PROJECT_ROOT, "bin", "install.js");

function removeTree(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return;
  }
  for (const entry of fs.readdirSync(target)) {
    removeTree(path.join(target, entry));
  }
  fs.rmdirSync(target);
}

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "muyi-statusline-install-"));
}

function runInstaller(home) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      HOME: home,
      USERPROFILE: home,
    }),
  });
}

function permissions(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

function testFreshInstall() {
  const home = makeHome();
  try {
    const result = runInstaller(home);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const claudeDir = path.join(home, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");
    const statuslinePath = path.join(claudeDir, "statusline.js");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

    assert.strictEqual(settings.statusLine.type, "command");
    assert.strictEqual(settings.statusLine.padding, 1);
    assert.ok(settings.statusLine.command.includes(process.execPath));
    assert.ok(settings.statusLine.command.includes(statuslinePath));
    assert.ok(path.isAbsolute(statuslinePath));
    assert.ok(fs.readFileSync(statuslinePath, "utf8").includes("Claude Code"));

    if (process.platform !== "win32") {
      assert.strictEqual(permissions(settingsPath), 0o600);
      assert.strictEqual(permissions(statuslinePath), 0o755);
    }
  } finally {
    removeTree(home);
  }
}

function testPreservesFieldsPermissionsAndBackups() {
  const home = makeHome();
  try {
    const claudeDir = path.join(home, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");
    const statuslinePath = path.join(claudeDir, "statusline.js");
    fs.mkdirSync(claudeDir, { recursive: true });

    const originalSettings = {
      theme: "dark",
      permissions: { allow: ["Read", "Edit"] },
      statusLine: { type: "command", command: "old-statusline" },
    };
    const originalRaw = `${JSON.stringify(originalSettings, null, 2)}\n`;
    const originalScript = "#!/usr/bin/env node\nconsole.log('old');\n";
    fs.writeFileSync(settingsPath, originalRaw, { mode: 0o600 });
    fs.writeFileSync(statuslinePath, originalScript, { mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(settingsPath, 0o640);

    const result = runInstaller(home);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const updated = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.strictEqual(updated.theme, originalSettings.theme);
    assert.deepStrictEqual(updated.permissions, originalSettings.permissions);
    assert.notStrictEqual(updated.statusLine.command, "old-statusline");
    assert.strictEqual(fs.readFileSync(`${settingsPath}.bak`, "utf8"), originalRaw);
    assert.strictEqual(fs.readFileSync(`${statuslinePath}.bak`, "utf8"), originalScript);

    if (process.platform !== "win32") {
      assert.strictEqual(permissions(settingsPath), 0o640);
      assert.strictEqual(permissions(statuslinePath), 0o755);
    }
  } finally {
    removeTree(home);
  }
}

function testInvalidJsonDoesNotWriteAnything() {
  const home = makeHome();
  try {
    const claudeDir = path.join(home, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");
    const statuslinePath = path.join(claudeDir, "statusline.js");
    const invalidSettings = "{ definitely-not-json\n";
    const originalScript = "original statusline\n";
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, invalidSettings);
    fs.writeFileSync(statuslinePath, originalScript);

    const result = runInstaller(home);
    assert.notStrictEqual(result.status, 0);
    assert.ok(result.stderr.includes("不是有效的 JSON"), result.stderr);
    assert.strictEqual(fs.readFileSync(settingsPath, "utf8"), invalidSettings);
    assert.strictEqual(fs.readFileSync(statuslinePath, "utf8"), originalScript);
    assert.strictEqual(fs.existsSync(`${settingsPath}.bak`), false);
    assert.strictEqual(fs.existsSync(`${statuslinePath}.bak`), false);
  } finally {
    removeTree(home);
  }
}

function testNonObjectSettingsDoesNotWriteAnything() {
  const home = makeHome();
  try {
    const claudeDir = path.join(home, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, "[]\n");

    const result = runInstaller(home);
    assert.notStrictEqual(result.status, 0);
    assert.ok(result.stderr.includes("顶层必须是 JSON 对象"), result.stderr);
    assert.strictEqual(fs.readFileSync(settingsPath, "utf8"), "[]\n");
    assert.strictEqual(fs.existsSync(path.join(claudeDir, "statusline.js")), false);
  } finally {
    removeTree(home);
  }
}

testFreshInstall();
testPreservesFieldsPermissionsAndBackups();
testInvalidJsonDoesNotWriteAnything();
testNonObjectSettingsDoesNotWriteAnything();
console.log("installer tests passed");
