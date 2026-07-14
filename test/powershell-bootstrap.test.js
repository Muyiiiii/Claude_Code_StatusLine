"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const BOOTSTRAP = path.join(PROJECT_ROOT, "install-statusline.ps1");

function findPowerShell() {
  const candidates = process.platform === "win32"
    ? ["pwsh.exe", "powershell.exe"]
    : ["pwsh", "powershell"];

  for (const candidate of candidates) {
    const result = spawnSync(
      candidate,
      ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"],
      { encoding: "utf8" }
    );
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

test("PowerShell bootstrap keeps downloads isolated and cleans them up", () => {
  const source = fs.readFileSync(BOOTSTRAP, "utf8");
  assert.match(source, /muyi-code-statusline-/);
  assert.match(source, /\$baseUrl\/install\.js/);
  assert.match(source, /\$baseUrl\/statusline\.js/);
  assert.match(source, /& \$nodeCommand\.Source --check \$download/);
  assert.match(source, /finally\s*\{/);
  assert.match(source, /Remove-Item -LiteralPath \$tempDirectory -Recurse -Force/);
  assert.doesNotMatch(source, /^\s*exit\b/m);
});

const powerShell = findPowerShell();
test(
  "PowerShell parser accepts the Windows bootstrap",
  { skip: powerShell ? false : "PowerShell is not installed in this environment" },
  () => {
    const escapedPath = BOOTSTRAP.replace(/'/g, "''");
    const command = [
      "$tokens = $null",
      "$errors = $null",
      `[System.Management.Automation.Language.Parser]::ParseFile('${escapedPath}', [ref]$tokens, [ref]$errors) | Out-Null`,
      'if ($errors.Count -gt 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; throw "PowerShell parse failed" }',
    ].join("; ");
    const result = spawnSync(
      powerShell,
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8" }
    );
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  }
);
