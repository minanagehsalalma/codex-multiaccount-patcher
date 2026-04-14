const PLATFORM_VARIANT_SUFFIX = /-(darwin|linux|win32)-(arm64|x64)$/i;
const NUMERIC_VERSION = /^\d+\.\d+\.\d+$/;
const PRERELEASE_VERSION = /^(\d+)\.(\d+)\.(\d+)-([0-9A-Za-z.-]+)$/;

export function resolveStableVersions(versionStrings, {
  count = 5,
  minVersion = null,
} = {}) {
  const parsed = versionStrings
    .map((value) => normalizeCandidate(value))
    .filter(Boolean)
    .filter((entry) => entry.isStable)
    .filter((entry) => !minVersion || compareVersions(entry.version, minVersion) >= 0);

  const deduped = new Map();
  for (const entry of parsed) {
    deduped.set(entry.version, entry);
  }

  return [...deduped.values()]
    .sort((left, right) => compareVersions(right.version, left.version))
    .slice(0, count)
    .map((entry) => entry.version);
}

export function normalizeExplicitVersions(rawVersions) {
  return rawVersions
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeVersionTag);
}

export function buildVersionMatrix(versions, { targetSet = "fast" } = {}) {
  const targets = resolveTargets(targetSet);
  const matrix = [];
  for (const version of versions) {
    const codexRef = `rust-v${version}`;
    for (const target of targets) {
      matrix.push({
        codex_version: version,
        codex_ref: codexRef,
        release_tag: `compat-${version}`,
        ...target,
      });
    }
  }
  return matrix;
}

export function normalizeVersionTag(value) {
  return value.replace(/^rust-v/i, "").replace(/^v/i, "");
}

export function compareVersions(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);

  for (const key of ["major", "minor", "patch"]) {
    if (leftParts[key] !== rightParts[key]) {
      return leftParts[key] - rightParts[key];
    }
  }

  if (!leftParts.prerelease && !rightParts.prerelease) {
    return 0;
  }
  if (!leftParts.prerelease) {
    return 1;
  }
  if (!rightParts.prerelease) {
    return -1;
  }
  return leftParts.prerelease.localeCompare(rightParts.prerelease);
}

function normalizeCandidate(value) {
  if (!value || PLATFORM_VARIANT_SUFFIX.test(value)) {
    return null;
  }

  const normalized = normalizeVersionTag(value);
  if (NUMERIC_VERSION.test(normalized)) {
    return { version: normalized, isStable: true };
  }

  const prerelease = normalized.match(PRERELEASE_VERSION);
  if (prerelease) {
    return { version: normalized, isStable: false };
  }

  return null;
}

function parseSemver(value) {
  const normalized = normalizeVersionTag(value);
  if (NUMERIC_VERSION.test(normalized)) {
    const [major, minor, patch] = normalized.split(".").map(Number);
    return { major, minor, patch, prerelease: null };
  }

  const prerelease = normalized.match(PRERELEASE_VERSION);
  if (!prerelease) {
    throw new Error(`unsupported version format: ${value}`);
  }

  return {
    major: Number(prerelease[1]),
    minor: Number(prerelease[2]),
    patch: Number(prerelease[3]),
    prerelease: prerelease[4],
  };
}

function resolveTargets(targetSet) {
  switch (targetSet) {
    case "fast":
      return [
        {
          os: "ubuntu-latest",
          platform: "linux",
          arch: "x64",
          artifact_suffix: "linux-x64",
          executable_name: "codex",
        },
      ];
    case "full":
      return [
        {
          os: "ubuntu-latest",
          platform: "linux",
          arch: "x64",
          artifact_suffix: "linux-x64",
          executable_name: "codex",
        },
        {
          os: "windows-latest",
          platform: "win32",
          arch: "x64",
          artifact_suffix: "win32-x64",
          executable_name: "codex.exe",
        },
      ];
    default:
      throw new Error(`unsupported target set: ${targetSet}`);
  }
}
