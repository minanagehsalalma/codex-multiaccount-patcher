import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

import { AUTH_LEGACY_CLI_NAME, PRIMARY_CLI_NAME } from "./constants.js";
import { pathExists } from "./util.js";

export async function runAuthCli(context, args) {
  const launch = await resolveAuthCliLaunch(context);
  await spawnAndWait(launch.command, [...launch.args, ...args]);
}

async function resolveAuthCliLaunch(context) {
  if (!context.preferBundledAuth) {
    const globalEntrypoint = resolveGlobalAuthEntrypoint(context);
    if (globalEntrypoint && (await pathExists(globalEntrypoint))) {
      return {
        command: context.execPath,
        args: [globalEntrypoint],
      };
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
    return {
      command: context.execPath,
      args: [bundledEntrypoint],
    };
  }

  throw new Error(
    `auth toolkit is unavailable. Reinstall ${PRIMARY_CLI_NAME} so it bundles @loongphy/codex-auth, or install ${AUTH_LEGACY_CLI_NAME} separately.`,
  );
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
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "@loongphy", "codex-auth", "bin", "codex-auth.js");
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
