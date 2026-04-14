#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

function usage() {
  process.stdout.write(`detect-upstream-release

Optional:
  --repo <owner/name>     Defaults to openai/codex
  --field <name>          One of tagName or normalizedVersion
  --output <path>         Writes the latest release JSON to disk
\n`);
}

function parseArgs(argv) {
  const options = { repo: "openai/codex", field: "tagName" };
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

  const response = await fetch(`https://api.github.com/repos/${options.repo}/releases/latest`, {
    headers: {
      "User-Agent": "codex-hotpatch",
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  let payload;
  if (response.ok) {
    payload = await response.json();
  } else if (response.status === 403 || response.status === 429) {
    payload = await fetchLatestVersionFromNpm();
  } else {
    throw new Error(`failed to fetch latest release: ${response.status} ${response.statusText}`);
  }
  if (options.output) {
    await fs.mkdir(path.dirname(options.output), { recursive: true });
    const enrichedPayload = {
      ...payload,
      normalized_version: normalizeVersion(payload.tag_name),
    };
    await fs.writeFile(options.output, `${JSON.stringify(enrichedPayload, null, 2)}\n`, "utf8");
    payload = enrichedPayload;
  }
  const fieldValue = options.field === "normalizedVersion" ? normalizeVersion(payload.tag_name) : payload.tag_name;
  process.stdout.write(`${fieldValue}\n`);
}

async function fetchLatestVersionFromNpm() {
  const response = await fetch("https://registry.npmjs.org/@openai/codex/latest", {
    headers: {
      "User-Agent": "codex-hotpatch",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch npm latest version: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return {
    source: "npm-registry-fallback",
    tag_name: payload.version,
    name: payload.version,
    published_at: payload.date ?? null,
    package: payload.name,
  };
}

function normalizeVersion(tagName) {
  return tagName.replace(/^rust-v/i, "").replace(/^v/i, "");
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
