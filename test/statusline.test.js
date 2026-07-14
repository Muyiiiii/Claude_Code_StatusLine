"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("child_process");
const {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("fs");
const os = require("os");
const path = require("path");

const statuslinePath = path.resolve(__dirname, "..", "bin", "statusline.js");
const statusline = require(statuslinePath);

function makeSandbox(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "muyi-statusline-test-"));
  const home = path.join(root, "home");
  const temp = path.join(root, "temp");
  mkdirSync(home, { recursive: true });
  mkdirSync(temp, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    home,
    temp,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
    },
  };
}

function cachePathsFor(env) {
  const code = `process.stdout.write(JSON.stringify(require(${JSON.stringify(
    statuslinePath
  )}).getCachePaths()))`;
  return JSON.parse(execFileSync(process.execPath, ["-e", code], { env, encoding: "utf-8" }));
}

function prepareFreshCache(sandbox, contents) {
  const paths = cachePathsFor(sandbox.env);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  chmodSync(paths.directory, 0o700);
  writeFileSync(
    paths.cache,
    JSON.stringify(contents || { daily: [], totals: {} }),
    { mode: 0o600 }
  );
  return paths;
}

function runStatusline(input, sandbox, overrides) {
  const result = spawnSync(process.execPath, [statuslinePath], {
    cwd: sandbox.root,
    env: { ...sandbox.env, ...(overrides || {}) },
    input: JSON.stringify(input),
    encoding: "utf-8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitFor(predicate, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

test("normalizes hostile numeric, effort, and directory values", (t) => {
  const sandbox = makeSandbox(t);
  prepareFreshCache(sandbox);
  const output = stripAnsi(
    runStatusline(
      {
        model: { id: {}, display_name: "Bad\x1b[31m\nModel" },
        workspace: { current_dir: { nope: true } },
        effort: { level: ["high"] },
        context_window: {
          total_input_tokens: "Infinity",
          total_output_tokens: "-3",
          used_percentage: "999",
        },
        rate_limits: {
          five_hour: { used_percentage: "NaN", resets_at: {} },
          seven_day: { used_percentage: -12, resets_at: [] },
        },
        cost: {
          total_cost_usd: "not-a-number",
          total_lines_added: -4,
          total_lines_removed: "2.9",
        },
        fast_mode: "true",
      },
      sandbox
    )
  );

  assert.equal(output.trimEnd().split("\n").length, 4);
  assert.match(output, /\[BadModel\]/);
  assert.match(output, /📁 \?/);
  assert.match(output, /5h:░{8} 0%/);
  assert.match(output, /7d:░{8} 0%/);
  assert.match(output, /ctx:█{8} 100%/);
  assert.match(output, /0 files \+0 -2/);
  assert.doesNotMatch(output, /Infinity|NaN/);
  assert.doesNotMatch(output, /⚡|·High/);
});

test("maps only known model IDs and preserves future display names", () => {
  const mappings = [
    ["claude-fable-5", "Fable 5"],
    ["claude-mythos-5", "Mythos 5"],
    ["claude-mythos-preview", "Mythos Preview"],
    ["claude-opus-4-8", "Opus 4.8"],
    ["claude-opus-4-7", "Opus 4.7"],
    ["claude-opus-4-6", "Opus 4.6"],
    ["claude-sonnet-5", "Sonnet 5"],
    ["claude-sonnet-4-6", "Sonnet 4.6"],
    ["claude-haiku-4-5", "Haiku 4.5"],
    ["provider.claude-opus-4-8-20260701-v1:0", "Opus 4.8"],
  ];
  for (const [id, expected] of mappings) {
    assert.equal(statusline.modelName({ model: { id } }), expected);
  }
  assert.equal(
    statusline.modelName({ model: { id: "claude-opus-4-9", display_name: "Opus 4.9" } }),
    "Opus 4.9"
  );
  assert.equal(
    statusline.modelName({ model: { id: "claude-sonnet-5-1", display_name: "Sonnet 5.1" } }),
    "Sonnet 5.1"
  );
  assert.equal(
    statusline.modelName({ model: { id: "claude-opus-4-2", display_name: "Legacy Opus" } }),
    "Legacy Opus"
  );
  assert.equal(statusline.modelName({ model: { id: "claude-sonnet-4-2" } }), "Claude");
});

test("allows max from live effort input but not persisted settings", (t) => {
  const sandbox = makeSandbox(t);
  prepareFreshCache(sandbox);
  const claudeDir = path.join(sandbox.home, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");
  mkdirSync(claudeDir, { recursive: true });

  writeFileSync(settingsPath, JSON.stringify({ effortLevel: "max" }));
  assert.doesNotMatch(stripAnsi(runStatusline({}, sandbox)), /·Max/);

  writeFileSync(settingsPath, JSON.stringify({ effortLevel: "xhigh" }));
  assert.match(stripAnsi(runStatusline({}, sandbox)), /·xHigh/);

  writeFileSync(settingsPath, JSON.stringify({ effortLevel: "low" }));
  assert.match(
    stripAnsi(runStatusline({ effort: { level: "max" } }, sandbox)),
    /·Max/
  );
  assert.equal(statusline.normalizeEffort("xhigh", true), "xHigh");
});

test("runs Git in workspace.current_dir and includes every untracked file", (t) => {
  const sandbox = makeSandbox(t);
  prepareFreshCache(sandbox);
  const repo = path.join(sandbox.root, "repo; no-shell-expansion");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "feature/test"]);
  writeFileSync(path.join(repo, "tracked.txt"), "first\n");
  git(repo, ["add", "tracked.txt"]);
  git(repo, [
    "-c",
    "user.name=Statusline Test",
    "-c",
    "user.email=statusline@example.invalid",
    "commit",
    "-q",
    "-m",
    "initial",
  ]);
  writeFileSync(path.join(repo, "tracked.txt"), "changed\n");
  mkdirSync(path.join(repo, "new"));
  writeFileSync(path.join(repo, "new", "one.txt"), "one\n");
  writeFileSync(path.join(repo, "new", "two.txt"), "two\n");

  const output = stripAnsi(
    runStatusline({ workspace: { current_dir: repo } }, sandbox)
  );
  assert.match(output, /🌿 feature\/test/);
  assert.match(output, /3 files \+0 -0/);
  assert.equal(statSync(path.join(repo, "tracked.txt")).isFile(), true);
  assert.equal(path.dirname(repo), sandbox.root);
});

test("formats the ccusage date in local time instead of UTC", () => {
  const code = `const { localDate } = require(${JSON.stringify(
    statuslinePath
  )}); process.stdout.write(localDate(new Date("2026-01-01T01:30:00Z")))`;
  const output = execFileSync(process.execPath, ["-e", code], {
    env: { ...process.env, TZ: "America/Los_Angeles" },
    encoding: "utf-8",
  });
  assert.equal(output, "2025-12-31");
});

test("pins ccusage and gives npx its noninteractive flag", () => {
  assert.deepEqual(statusline.runnerArguments("bunx", "20260701"), [
    "ccusage@20.0.17",
    "claude",
    "daily",
    "--json",
    "--since",
    "20260701",
  ]);
  assert.deepEqual(statusline.runnerArguments("npx", "20260701"), [
    "--yes",
    "ccusage@20.0.17",
    "claude",
    "daily",
    "--json",
    "--since",
    "20260701",
  ]);
});

test(
  "refreshes through an isolated fake runner without a shell",
  { skip: process.platform === "win32" },
  async (t) => {
    const sandbox = makeSandbox(t);
    const fakeBin = path.join(sandbox.root, "fake bin;still-data");
    const invocation = path.join(sandbox.root, "runner-arguments.json");
    const fakeNpx = path.join(fakeBin, "npx");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      fakeNpx,
      `#!${process.execPath}\n` +
        `require("fs").writeFileSync(${JSON.stringify(invocation)}, JSON.stringify(process.argv.slice(2)));\n` +
        `process.stdout.write(JSON.stringify({ daily: [], totals: { totalCost: 1 } }));\n`
    );
    chmodSync(fakeNpx, 0o755);
    sandbox.env.PATH = fakeBin;
    const paths = cachePathsFor(sandbox.env);

    runStatusline({}, sandbox, { PATH: fakeBin });
    assert.equal(
      await waitFor(() => existsSync(paths.cache) && !existsSync(paths.lock), 3000),
      true
    );
    const args = JSON.parse(readFileSync(invocation, "utf-8"));
    assert.deepEqual(args.slice(0, 6), [
      "--yes",
      "ccusage@20.0.17",
      "claude",
      "daily",
      "--json",
      "--since",
    ]);
    assert.match(args[6], /^\d{6}01$/);
    assert.deepEqual(JSON.parse(readFileSync(paths.cache, "utf-8")), {
      daily: [],
      totals: { totalCost: 1 },
    });
    assert.equal(readdirSync(paths.directory).some((name) => name.endsWith(".tmp")), false);
    assert.equal(existsSync(path.join(sandbox.root, "still-data")), false);
  }
);

test("isolates a 0700 cache and backs off when no runner exists", (t) => {
  const sandbox = makeSandbox(t);
  sandbox.env.PATH = "";
  const paths = cachePathsFor(sandbox.env);

  runStatusline({}, sandbox, { PATH: "" });
  assert.equal(statSync(paths.directory).isDirectory(), true);
  if (process.platform !== "win32") {
    assert.equal(statSync(paths.directory).mode & 0o777, 0o700);
  }
  assert.equal(statSync(paths.runnerMiss).isFile(), true);
  assert.equal(existsSync(paths.lock), false);

  // A distinctive, fresh marker proves the next render does not retry discovery.
  writeFileSync(paths.runnerMiss, "do-not-retry\n", { mode: 0o600 });
  runStatusline({}, sandbox, { PATH: "" });
  assert.equal(readFileSync(paths.runnerMiss, "utf-8"), "do-not-retry\n");
});

test(
  "backs off after an installed runner fails",
  { skip: process.platform === "win32" },
  async (t) => {
    const sandbox = makeSandbox(t);
    const fakeBin = path.join(sandbox.root, "offline-runner");
    const calls = path.join(sandbox.root, "calls.txt");
    const fakeNpx = path.join(fakeBin, "npx");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      fakeNpx,
      `#!${process.execPath}\n` +
        `require("fs").appendFileSync(${JSON.stringify(calls)}, "called\\n");\n` +
        `process.exitCode = 1;\n`
    );
    chmodSync(fakeNpx, 0o755);
    const paths = cachePathsFor({ ...sandbox.env, PATH: fakeBin });

    runStatusline({}, sandbox, { PATH: fakeBin });
    assert.equal(
      await waitFor(() => existsSync(paths.runnerMiss) && !existsSync(paths.lock), 3000),
      true
    );
    assert.equal(readFileSync(calls, "utf-8"), "called\n");

    runStatusline({}, sandbox, { PATH: fakeBin });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(readFileSync(calls, "utf-8"), "called\n");
  }
);

test("cache directory failures degrade to zero cost without exiting", (t) => {
  const sandbox = makeSandbox(t);
  const unusableTemp = path.join(sandbox.root, "not-a-directory");
  writeFileSync(unusableTemp, "file\n");
  const output = stripAnsi(
    runStatusline({}, sandbox, {
      PATH: "",
      TMPDIR: unusableTemp,
      TMP: unusableTemp,
      TEMP: unusableTemp,
    })
  );
  assert.equal(output.trimEnd().split("\n").length, 4);
  assert.match(output, /today:\$0\.00\(0\)/);
  assert.match(output, /month:\$0\.00\(0\)/);
});

test("porcelain parser counts a rename as one changed file", () => {
  assert.equal(statusline.countPorcelainEntries("R  new name\0old name\0?? untracked\0"), 2);
});
