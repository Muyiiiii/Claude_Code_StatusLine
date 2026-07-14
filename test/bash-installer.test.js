const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const INSTALLER = path.join(ROOT, "install-statusline.sh");

function hasCommand(command, args = ["--version"]) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

const missingDependency = process.platform === "win32"
  ? "Bash installer is not supported on Windows"
  : !hasCommand("bash") || !hasCommand("jq") || !hasCommand("git")
    ? "bash, jq, and git are required"
    : !hasCommand("bun") && !hasCommand("npx")
      ? "bun or npx is required"
      : false;

function makeHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muyi-bash-installer-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function runInstaller(home) {
  return spawnSync("bash", [INSTALLER], {
    cwd: ROOT,
    env: { ...process.env, HOME: home },
    encoding: "utf8",
    timeout: 15_000,
  });
}

test("bash installer creates private settings and an executable pinned script", { skip: missingDependency }, (t) => {
  const home = makeHome(t);
  const result = runInstaller(home);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const claudeDir = path.join(home, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");
  const scriptPath = path.join(claudeDir, "statusline.sh");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const script = fs.readFileSync(scriptPath, "utf8");

  assert.equal(settings.statusLine.command, "~/.claude/statusline.sh");
  assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(scriptPath).mode & 0o777, 0o755);
  assert.match(script, /ccusage@20\.0\.17/);
  assert.match(script, /ccusage@20\.0\.17 claude daily/);
  assert.doesNotMatch(script, /ccusage@latest/);

  const tempRoot = path.join(home, "tmp");
  const cacheDir = path.join(tempRoot, `muyi_code_statusline-cache-${process.getuid()}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "daily.json"), JSON.stringify({ daily: [], totals: {} }));
  const rendered = spawnSync(scriptPath, [], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, TMPDIR: tempRoot },
    input: JSON.stringify({
      model: { id: "claude-fable-5", display_name: "Claude Fable 5" },
      workspace: { current_dir: ROOT },
      effort: { level: "max" },
    }),
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /Fable 5/);
  assert.match(rendered.stdout, /·Max/);
  assert.doesNotMatch(rendered.stdout, /\x1b\[97m/);
  assert.match(rendered.stdout, /\x1b\[39m5h\x1b\[0m/);

  const hostile = spawnSync(scriptPath, [], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, TMPDIR: tempRoot },
    input: JSON.stringify({
      model: { id: "future-model", display_name: "Future\\c\n\x1b[31mRed" },
      workspace: { current_dir: ROOT },
    }),
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(hostile.status, 0, hostile.stderr);
  assert.equal(hostile.stdout.trimEnd().split("\n").length, 4);
  assert.ok(hostile.stdout.includes("Future\\c[31mRed"), JSON.stringify(hostile.stdout));
  assert.doesNotMatch(hostile.stdout, /\x1b\[31m/);

  const futureModel = spawnSync(scriptPath, [], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, TMPDIR: tempRoot },
    input: JSON.stringify({
      model: { id: "claude-sonnet-5-1", display_name: "Sonnet 5.1" },
      workspace: { current_dir: ROOT },
    }),
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(futureModel.status, 0, futureModel.stderr);
  assert.match(futureModel.stdout, /Sonnet 5\.1/);
  assert.doesNotMatch(futureModel.stdout, /Sonnet 5\x1b/);

  const malformed = spawnSync(scriptPath, [], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, TMPDIR: tempRoot },
    input: "{not-json\n",
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(malformed.status, 0, malformed.stderr);
  assert.equal(malformed.stdout.trimEnd().split("\n").length, 4);
  assert.match(malformed.stdout, /5h.*0%/);
  assert.match(malformed.stdout, /0 files \+0 -0/);

  const symlinkTemp = path.join(home, "symlink-temp");
  const symlinkTarget = path.join(home, "must-remain-empty");
  const unsafeCache = path.join(
    symlinkTemp,
    `muyi_code_statusline-cache-${process.getuid()}`
  );
  fs.mkdirSync(symlinkTemp, { recursive: true });
  fs.mkdirSync(symlinkTarget);
  fs.symlinkSync(symlinkTarget, unsafeCache, "dir");
  const symlinkRun = spawnSync(scriptPath, [], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, TMPDIR: symlinkTemp },
    input: "{}",
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(symlinkRun.status, 0, symlinkRun.stderr);
  assert.deepEqual(fs.readdirSync(symlinkTarget), []);
});

test("bash installer preserves fields, permissions, and rollback copies", { skip: missingDependency }, (t) => {
  const home = makeHome(t);
  const claudeDir = path.join(home, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");
  const scriptPath = path.join(claudeDir, "statusline.sh");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ marker: "keep", statusLine: { command: "old" } }));
  fs.chmodSync(settingsPath, 0o600);
  fs.writeFileSync(scriptPath, "#!/bin/bash\necho old\n");
  fs.chmodSync(scriptPath, 0o700);

  const result = runInstaller(home);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(settings.marker, "keep");
  assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(`${settingsPath}.bak`, "utf8"), /"marker":"keep"/);
  assert.equal(fs.readFileSync(`${scriptPath}.bak`, "utf8"), "#!/bin/bash\necho old\n");
});

test("bash installer rejects invalid settings before changing the script", { skip: missingDependency }, (t) => {
  const home = makeHome(t);
  const claudeDir = path.join(home, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");
  const scriptPath = path.join(claudeDir, "statusline.sh");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(settingsPath, "{not-json\n");
  fs.writeFileSync(scriptPath, "original-script\n");

  const result = runInstaller(home);
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(settingsPath, "utf8"), "{not-json\n");
  assert.equal(fs.readFileSync(scriptPath, "utf8"), "original-script\n");
});
