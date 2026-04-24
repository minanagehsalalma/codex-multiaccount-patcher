import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_GITHUB_OWNER, DEFAULT_GITHUB_REPO, PRIMARY_CLI_NAME } from "./constants.js";
import { readJson, runCommand } from "./util.js";

export function npmCommand(platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function publishedInstallSpec() {
  return `github:${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}`;
}

export function parsePackJson(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`failed to parse npm pack output: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0]?.filename !== "string") {
    throw new Error("npm pack did not return a tarball filename");
  }
  return parsed[0].filename;
}

function quoteForCmd(arg) {
  const value = String(arg);
  if (value.length === 0) {
    return '""';
  }
  if (!/[ \t"&()^|<>]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

async function runNpm(context, args, options = {}) {
  if (context.platform !== "win32") {
    return runCommand(npmCommand(context.platform), args, options);
  }
  const commandLine = [npmCommand(context.platform), ...args].map(quoteForCmd).join(" ");
  return runCommand(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], options);
}

export async function installPublishedToolkit(context) {
  await stopBlockingWindowsAuthProcesses(context);
  const result = await runNpm(context, ["install", "-g", publishedInstallSpec(), "--force"], {
    stdio: "inherit",
  });
  if (result.code !== 0) {
    throw new Error(`failed to upgrade ${PRIMARY_CLI_NAME} from the published repo`);
  }
}

export async function installCurrentCheckout(context) {
  const packageJsonPath = path.join(context.projectRoot, "package.json");
  const packageJson = await readJson(packageJsonPath);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-multiaccount-pack-"));
  try {
    const packResult = await runNpm(context, ["pack", context.projectRoot, "--json"], { cwd: tempDir });
    if (packResult.code !== 0) {
      throw new Error(`failed to pack current checkout for ${PRIMARY_CLI_NAME}`);
    }

    const tarballName = parsePackJson(packResult.stdout);
    const tarballPath = path.join(tempDir, tarballName);
    await stopBlockingWindowsAuthProcesses(context);
    const installResult = await runNpm(context, ["install", "-g", tarballPath, "--force"], {
      stdio: "inherit",
    });
    if (installResult.code !== 0) {
      throw new Error(`failed to self-install ${PRIMARY_CLI_NAME} from the current checkout`);
    }

    return {
      packageName: packageJson.name,
      version: packageJson.version,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function stopBlockingWindowsAuthProcesses(context) {
  if (context.platform !== "win32") {
    return { skipped: true, stopped: [] };
  }

  const powershellPath = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script = [
    "try {",
    "  $needles = @('codex-multiaccount-patcher', 'codex-auth-working-snapshot')",
    "  $processes = @(Get-Process -Name 'codex-auth-auto','codex-auth' -ErrorAction SilentlyContinue)",
    "  foreach ($process in $processes) {",
    "    $processPath = $process.Path",
    "    if (-not $processPath) { continue }",
    "    $owned = $false",
    "    foreach ($needle in $needles) {",
    "      if ($processPath -like \"*$needle*\") { $owned = $true; break }",
    "    }",
    "    if (-not $owned) { continue }",
    "    Stop-Process -Id $process.Id -Force -ErrorAction Stop",
    "    \"$($process.ProcessName):$($process.Id)\"",
    "  }",
    "  exit 0",
    "} catch {",
    "  Write-Error $_",
    "  exit 1",
    "}",
  ].join("\n");
  const result = await runCommand(powershellPath, ["-NoLogo", "-NoProfile", "-Command", script]);
  if (result.code !== 0) {
    throw new Error(`failed to stop blocking auth helper processes: ${result.stderr || result.stdout}`.trim());
  }
  return {
    skipped: false,
    stopped: result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
  };
}
