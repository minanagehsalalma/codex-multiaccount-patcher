import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

import { AUTH_LEGACY_CLI_NAME, PRIMARY_CLI_NAME } from "./constants.js";
import { pathExists } from "./util.js";

export async function runAuthCli(context, args) {
  const launch = await inspectAuthCli(context);
  await spawnAndWait(launch.command, [...launch.args, ...args]);
}

export async function inspectAuthCli(context) {
  if (context.platform === "win32" && context.arch === "x64") {
    const vendoredEntrypoint = path.join(
      context.projectRoot,
      "vendor",
      "codex-auth-working-snapshot",
      "bin",
      "codex-auth.js",
    );
    if (await pathExists(vendoredEntrypoint)) {
      return buildAuthInspection(context, "vendored-working-snapshot", vendoredEntrypoint);
    }
  }

  if (!context.preferBundledAuth) {
    const globalEntrypoint = resolveGlobalAuthEntrypoint(context);
    if (globalEntrypoint && (await pathExists(globalEntrypoint))) {
      return buildAuthInspection(context, "global-install", globalEntrypoint);
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
    return buildAuthInspection(context, "bundled-npm-fallback", bundledEntrypoint);
  }

  throw new Error(
    `auth toolkit is unavailable. Reinstall ${PRIMARY_CLI_NAME} so it bundles @loongphy/codex-auth or includes the vendored snapshot, or install ${AUTH_LEGACY_CLI_NAME} separately.`,
  );
}

export async function captureAuthCli(context, args) {
  const launch = await inspectAuthCli(context);
  const child = spawn(launch.command, [...launch.args, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

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

async function spawnAndWait(command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env },
    windowsHide: true,
  });

  child.on("error", (error) => {
    process.stderr.write(`error: failed to launch auth toolkit: ${error.message}\n`);
    process.exit(1);
  });

  const outcome = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  if (outcome.signal) {
    process.kill(process.pid, outcome.signal);
    return;
  }
  process.exit(outcome.code ?? 1);
}
