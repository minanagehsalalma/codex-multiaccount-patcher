import { normalizeVersionTag } from "./upstream-versions.js";

const SEMVER_LIKE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function isSemverLikeTag(value) {
  return SEMVER_LIKE.test(normalizeVersionTag(`${value ?? ""}`.trim()));
}

export function resolveCodexRef(value) {
  const raw = `${value ?? ""}`.trim();
  if (!raw) {
    throw new Error("upstream ref is required");
  }
  if (!isSemverLikeTag(raw)) {
    return raw;
  }
  if (/^rust-v/i.test(raw) || /^v/i.test(raw)) {
    return raw;
  }
  return `rust-v${normalizeVersionTag(raw)}`;
}

export function sanitizeReleaseTagComponent(value) {
  const sanitized = `${value ?? ""}`
    .trim()
    .replace(/[^0-9A-Za-z._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!sanitized) {
    throw new Error("release tag component is empty after sanitization");
  }
  return sanitized;
}

export function normalizeGitHubRepo(value) {
  const repo = `${value ?? ""}`.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\/+$/, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error(`invalid GitHub repo: ${value}`);
  }
  return repo;
}

export function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  switch (`${value}`.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`invalid boolean flag: ${value}`);
  }
}

export function resolveGitHubReleaseAssetName(platform, arch) {
  switch (`${platform}-${arch}`) {
    case "linux-x64":
      return "codex-linux-x64";
    case "win32-x64":
      return "codex-win32-x64.exe";
    default:
      throw new Error(`unsupported GitHub release asset target ${platform}-${arch}`);
  }
}
