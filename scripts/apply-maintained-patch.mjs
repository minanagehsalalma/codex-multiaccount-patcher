#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { applyMaintainedPatch } from "../src/lib/maintained-patch.js";

function usage() {
  process.stdout.write(`apply-maintained-patch

Required:
  --upstream-root <path>

Optional:
  --mode <apply|check>   Defaults to apply
  --json                 Print machine-readable output
\n`);
}

function parseArgs(argv) {
  const options = { mode: "apply", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${arg}`);
    }
    options[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
    i += 1;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (!options.upstreamRoot) {
    throw new Error("missing required option --upstream-root");
  }
  if (!["apply", "check"].includes(options.mode)) {
    throw new Error(`unsupported mode ${options.mode}`);
  }

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await applyMaintainedPatch({
    projectRoot,
    upstreamRoot: path.resolve(process.cwd(), options.upstreamRoot),
    mode: options.mode,
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          clientPath: result.clientPath,
          runtime: {
            changed: result.runtime.changed,
            steps: result.runtime.steps,
          },
          testSuiteModPath: result.testSuiteModPath,
          testSuiteMod: {
            changed: result.testSuiteMod.changed,
            steps: result.testSuiteMod.steps,
          },
          fallbackPatch: result.fallbackPatch,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(`runtime-rewrites: ${result.runtime.steps.map((step) => `${step.id}:${step.status}`).join(", ")}\n`);
  process.stdout.write(`suite-mod-rewrites: ${result.testSuiteMod.steps.map((step) => `${step.id}:${step.status}`).join(", ")}\n`);
  process.stdout.write(`fallback-patch: ${result.fallbackPatch.status}\n`);
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
