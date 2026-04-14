import path from "node:path";

export const STATE_SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 1;
export const DEFAULT_GITHUB_OWNER = "minanagehsalalma";
export const DEFAULT_GITHUB_REPO = "codex-hotpatch";

export function appDirs(homeDir) {
  const rootDir = path.join(homeDir, ".codex-hotpatch");
  return {
    rootDir,
    binDir: path.join(rootDir, "bin"),
    overlaysDir: path.join(rootDir, "overlays"),
    manifestsDir: path.join(rootDir, "manifests"),
    statePath: path.join(rootDir, "state.json"),
    manifestPath: path.join(rootDir, "manifests", "active.json"),
  };
}

export function defaultManifestUrl() {
  return `https://github.com/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/releases/latest/download/manifest.json`;
}
