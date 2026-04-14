#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  commandInstall,
  commandLaunch,
  commandRepair,
  commandStatus,
  commandUninstall,
} from "./lib/commands.js";

function usage() {
  process.stdout.write(`codex-hotpatch

Commands:
  install [--overlay-path <path>] [--manifest <file-or-url>] [--path <upstream-binary>] [--force]
  status
  repair
  uninstall
  launch -- [codex args...]
\n`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const positional = [];
  let passthrough = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--") {
      passthrough = rest.slice(i + 1);
      break;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--overlay-path" || arg === "--manifest" || arg === "--path") {
      const value = rest[i + 1];
      if (!value) {
        throw new Error(`missing value for ${arg}`);
      }
      options[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
      i += 1;
      continue;
    }
    positional.push(arg);
  }

  return { command, options, positional, passthrough };
}

async function ensureProjectRoot() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await fs.mkdir(root, { recursive: true });
  return root;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const projectRoot = await ensureProjectRoot();
  const context = {
    cwd: process.cwd(),
    homeDir: os.homedir(),
    platform: process.platform,
    arch: process.arch,
    projectRoot,
    execPath: process.execPath,
  };

  switch (parsed.command) {
    case "install":
      await commandInstall(context, parsed.options);
      return;
    case "status":
      await commandStatus(context);
      return;
    case "repair":
      await commandRepair(context);
      return;
    case "uninstall":
      await commandUninstall(context);
      return;
    case "launch":
      await commandLaunch(context, parsed.passthrough.length > 0 ? parsed.passthrough : parsed.positional);
      return;
    case "--help":
    case "-h":
    case "help":
    case undefined:
      usage();
      return;
    default:
      throw new Error(`unknown command: ${parsed.command}`);
  }
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
