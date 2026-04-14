#!/usr/bin/env node
import process from "node:process";

import {
  buildVersionMatrix,
  normalizeExplicitVersions,
  resolveStableVersions,
} from "../src/lib/upstream-versions.js";

function usage() {
  process.stdout.write(`resolve-version-matrix

Optional:
  --versions <csv>         Explicit versions or tags such as 0.120.0,rust-v0.119.0
  --count <n>              Number of recent stable versions when --versions is omitted
  --min-version <version>  Minimum stable version to include
  --target-set <fast|full> Defaults to fast
\n`);
}

function parseArgs(argv) {
  const options = {
    count: "5",
    targetSet: "fast",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
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

  const versions = options.versions
    ? normalizeExplicitVersions(options.versions)
    : resolveStableVersions(await fetchAllPublishedVersions(), {
        count: Number(options.count),
        minVersion: options.minVersion ?? null,
      });

  if (versions.length === 0) {
    throw new Error("no upstream versions resolved");
  }

  const include = buildVersionMatrix(versions, {
    targetSet: options.targetSet,
  });

  process.stdout.write(`${JSON.stringify({ include })}\n`);
}

async function fetchAllPublishedVersions() {
  const response = await fetch("https://registry.npmjs.org/@openai/codex", {
    headers: {
      "User-Agent": "codex-hotpatch",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch npm version list: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return Object.keys(payload.versions ?? {});
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
