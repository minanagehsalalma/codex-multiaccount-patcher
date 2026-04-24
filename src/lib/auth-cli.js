import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

import { AUTH_LEGACY_CLI_NAME, PRIMARY_CLI_NAME } from "./constants.js";
import { pathExists } from "./util.js";

export async function runAuthCli(context, args) {
  const outcome = await forwardAuthCli(context, args);
  if (outcome.signal) {
    process.kill(process.pid, outcome.signal);
    return;
  }
  process.exit(outcome.code ?? 1);
}

export async function forwardAuthCli(context, args) {
  const candidates = await resolveAuthCliCandidates(context);
  return runAuthCliCandidates(candidates, args, { captureOutput: false });
}

export async function inspectAuthCli(context) {
  const [firstCandidate] = await resolveAuthCliCandidates(context);
  if (firstCandidate) {
    return firstCandidate;
  }
  throw new Error(
    `auth toolkit is unavailable. Reinstall ${PRIMARY_CLI_NAME} so it bundles @loongphy/codex-auth or includes the vendored snapshot, or install ${AUTH_LEGACY_CLI_NAME} separately.`,
  );
}

export async function resolveAuthCliCandidates(context) {
  const candidates = [];
  const seenEntrypoints = new Set();

  const pushCandidate = (candidate) => {
    if (!candidate || seenEntrypoints.has(candidate.entrypoint)) {
      return;
    }
    seenEntrypoints.add(candidate.entrypoint);
    candidates.push(candidate);
  };

  if (context.platform === "win32" && context.arch === "x64") {
    const vendoredEntrypoint = path.join(
      context.projectRoot,
      "vendor",
      "codex-auth-working-snapshot",
      "bin",
      "codex-auth.js",
    );
    if (await pathExists(vendoredEntrypoint)) {
      pushCandidate(buildAuthInspection(context, "vendored-working-snapshot", vendoredEntrypoint));
    }
  }

  if (!context.preferBundledAuth) {
    const globalEntrypoint = resolveGlobalAuthEntrypoint(context);
    if (globalEntrypoint && (await pathExists(globalEntrypoint))) {
      pushCandidate(buildAuthInspection(context, "global-install", globalEntrypoint));
    }
  }

  const bundledEntrypoint = path.join(
    context.projectRoot,
    "node_modules",
    "@loongphy",
    "codex-auth",
    "bin",
    "codex-auth.js",
  );
  if (await pathExists(bundledEntrypoint)) {
    pushCandidate(buildAuthInspection(context, "bundled-npm-fallback", bundledEntrypoint));
  }

  return candidates;
}

export async function captureAuthCli(context, args) {
  const candidates = await resolveAuthCliCandidates(context);
  return runAuthCliCandidates(candidates, args, { captureOutput: true });
}

function buildAuthInspection(context, source, entrypoint) {
  const codexHome = path.join(context.homeDir, ".codex");
  const accountsDir = path.join(codexHome, "accounts");
  return {
    source,
    entrypoint,
    command: context.execPath,
    args: [entrypoint],
    codexHome,
    accountsDir,
    registryPath: path.join(accountsDir, "registry.json"),
    activeAuthPath: path.join(codexHome, "auth.json"),
  };
}

function resolveGlobalAuthEntrypoint(context) {
  try {
    const npmCommand = context.platform === "win32" ? "npm.cmd" : "npm";
    const npmRoot = execFileSync(npmCommand, ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (npmRoot) {
      return path.join(npmRoot, "@loongphy", "codex-auth", "bin", "codex-auth.js");
    }
  } catch {
    // fall through to platform-default probes
  }

  if (context.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      "npm",
      "node_modules",
      "@loongphy",
      "codex-auth",
      "bin",
      "codex-auth.js",
    );
  }
  return path.join("/usr/local/lib/node_modules", "@loongphy", "codex-auth", "bin", "codex-auth.js");
}

export function parseAutoSwitchEnabled(output) {
  const normalized = String(output ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const line of normalized.split(/\r?\n/)) {
    const match = /^auto-switch:\s*(on|off)\s*$/i.exec(line.trim());
    if (match) {
      return match[1].toLowerCase() === "on";
    }
  }
  return null;
}

async function spawnAndCapture(launch, args, { captureOutput }) {
  const child = spawn(launch.command, [...launch.args, ...args], {
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env },
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  if (captureOutput) {
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
  }

  const outcome = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });

  return {
    ...launch,
    code: outcome.code ?? (outcome.signal ? 1 : 0),
    signal: outcome.signal ?? null,
    stdout,
    stderr,
  };
}

async function runAuthCliCandidates(candidates, args, options) {
  if (!candidates.length) {
    throw new Error(
      `auth toolkit is unavailable. Reinstall ${PRIMARY_CLI_NAME} so it bundles @loongphy/codex-auth or includes the vendored snapshot, or install ${AUTH_LEGACY_CLI_NAME} separately.`,
    );
  }

  let lastOutcome = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const outcome = await spawnAndCapture(candidates[index], args, options);
    lastOutcome = outcome;
    if (outcome.code === 0 || !shouldRetryAuthWithNextCandidate(outcome)) {
      return outcome;
    }
  }
  return lastOutcome;
}

function shouldRetryAuthWithNextCandidate(outcome) {
  const combinedOutput = `${outcome.stdout ?? ""}\n${outcome.stderr ?? ""}`;
  return /Register-ScheduledTask/i.test(combinedOutput) && /Access is denied|0x80070005/i.test(combinedOutput);
}
