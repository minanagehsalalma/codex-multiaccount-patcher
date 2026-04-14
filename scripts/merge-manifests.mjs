#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

function usage() {
  process.stdout.write(`merge-manifests

Required:
  --input-dir <directory>
  --output <path>
\n`);
}

function parseArgs(argv) {
  const options = {};
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

async function readManifest(targetPath) {
  const raw = await fs.readFile(targetPath, "utf8");
  const manifest = JSON.parse(raw);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.records)) {
    throw new Error(`invalid manifest: ${targetPath}`);
  }
  return manifest;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (!options.inputDir || !options.output) {
    throw new Error("missing required options --input-dir and/or --output");
  }

  const entries = await fs.readdir(options.inputDir, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const manifest = await readManifest(path.join(options.inputDir, entry.name));
    records.push(...manifest.records);
  }

  const merged = [];
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) {
      continue;
    }
    seen.add(record.id);
    merged.push(record);
  }

  const output = { schemaVersion: 1, records: merged };
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${options.output}\n`);
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
