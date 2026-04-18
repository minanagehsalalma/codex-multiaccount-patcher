#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

import { selectLatestGitHubRelease } from "../src/lib/upstream-release.js";
import { normalizeVersionTag } from "../src/lib/upstream-versions.js";
import { normalizeGitHubRepo, parseBooleanFlag } from "../src/lib/upstream-source.js";

function usage() {
  process.stdout.write(`detect-upstream-release

Optional:
  --repo <owner/name>            Defaults to openai/codex
  --field <name>                 One of tagName, normalizedVersion, repo, isPrerelease, source, or json
  --include-prereleases <bool>   Include prereleases when selecting the latest GitHub release
  --output <path>                Writes the selected release JSON to disk
\n`);
}

function parseArgs(argv) {
  const options = { repo: "openai/codex", field: "tagName", includePrereleases: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (key === "includePrereleases") {
      const maybeValue = argv[i + 1];
      if (!maybeValue || maybeValue.startsWith("--")) {
        options.includePrereleases = true;
        continue;
      }
      options.includePrereleases = parseBooleanFlag(maybeValue, true);
      i += 1;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${arg}`);
    }
    options[key] = value;
    i += 1;
  }
  options.repo = normalizeGitHubRepo(options.repo);
  options.includePrereleases = parseBooleanFlag(options.includePrereleases, false);
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  let payload;
  try {
    payload = await fetchLatestRelease(options.repo, {
      includePrereleases: options.includePrereleases,
    });
  } catch (error) {
    if (shouldFallbackToNpm(options.repo, error)) {
      payload = await fetchLatestVersionFromNpm();
    } else {
      throw error;
    }
  }

  const enrichedPayload = {
    ...payload,
    source: payload.source ?? "github-releases",
    repo: options.repo,
    normalized_version: normalizeVersion(payload.tag_name),
    is_prerelease: Boolean(payload.prerelease),
  };

  if (options.output) {
    await fs.mkdir(path.dirname(options.output), { recursive: true });
    await fs.writeFile(options.output, `${JSON.stringify(enrichedPayload, null, 2)}\n`, "utf8");
  }

  const fieldValue = resolveField(enrichedPayload, options.field);
  process.stdout.write(`${fieldValue}\n`);
}

function resolveField(payload, field) {
  switch (field) {
    case "tagName":
      return payload.tag_name;
    case "normalizedVersion":
      return payload.normalized_version;
    case "repo":
      return payload.repo;
    case "isPrerelease":
      return payload.is_prerelease ? "true" : "false";
    case "source":
      return payload.source;
    case "json":
      return JSON.stringify(payload);
    default:
      throw new Error(`unsupported field: ${field}`);
  }
}

async function fetchLatestRelease(repo, { includePrereleases }) {
  if (!includePrereleases) {
    const latestResponse = await githubJson(`https://api.github.com/repos/${repo}/releases/latest`);
    if (latestResponse.ok) {
      return latestResponse.payload;
    }
    if (![404].includes(latestResponse.status)) {
      if (latestResponse.status === 403 || latestResponse.status === 429) {
        throw createGithubFetchError("latest release rate limited", latestResponse);
      }
      throw createGithubFetchError("failed to fetch latest release", latestResponse);
    }
  }

  const listResponse = await githubJson(`https://api.github.com/repos/${repo}/releases?per_page=20`);
  if (!listResponse.ok) {
    throw createGithubFetchError("failed to list releases", listResponse);
  }
  try {
    return selectLatestGitHubRelease(listResponse.payload, { includePrereleases });
  } catch (error) {
    throw new Error(`${error.message} for ${repo}`);
  }
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "codex-multiaccount-patcher",
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    payload,
  };
}

function createGithubFetchError(prefix, response) {
  const details =
    response?.payload && typeof response.payload === "object" && response.payload.message
      ? response.payload.message
      : response?.statusText;
  return new Error(`${prefix}: ${response.status} ${details ?? "Unknown error"}`.trim());
}

function shouldFallbackToNpm(repo, error) {
  return repo === "openai/codex" && /rate limited|404/i.test(error.message);
}

async function fetchLatestVersionFromNpm() {
  const response = await fetch("https://registry.npmjs.org/@openai/codex/latest", {
    headers: {
      "User-Agent": "codex-multiaccount-patcher",
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
    prerelease: false,
  };
}

function normalizeVersion(tagName) {
  return normalizeVersionTag(tagName);
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
