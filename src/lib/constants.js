import path from "node:path";

export const STATE_SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 1;
export const DEFAULT_GITHUB_OWNER = "minanagehsalalma";
export const DEFAULT_GITHUB_REPO = "codex-multiaccount-patcher";
export const PRIMARY_CLI_NAME = "codex-multiaccount";
export const LEGACY_CLI_NAME = "codex-hotpatch";
export const AUTH_LEGACY_CLI_NAME = "codex-auth";
export const APP_DIR_NAME = ".codex-multiaccount";
export const LEGACY_APP_DIR_NAME = ".codex-hotpatch";

export function appDirs(homeDir) {
  const rootDir = path.join(homeDir, APP_DIR_NAME);
  const legacyRootDir = path.join(homeDir, LEGACY_APP_DIR_NAME);
  return {
    rootDir,
    binDir: path.join(rootDir, "bin"),
    overlaysDir: path.join(rootDir, "overlays"),
    manifestsDir: path.join(rootDir, "manifests"),
    statePath: path.join(rootDir, "state.json"),
    manifestPath: path.join(rootDir, "manifests", "active.json"),
    legacy: {
      rootDir: legacyRootDir,
      binDir: path.join(legacyRootDir, "bin"),
      overlaysDir: path.join(legacyRootDir, "overlays"),
      manifestsDir: path.join(legacyRootDir, "manifests"),
      statePath: path.join(legacyRootDir, "state.json"),
      manifestPath: path.join(legacyRootDir, "manifests", "active.json"),
    },
  };
}

export function defaultManifestUrl() {
  return `https://github.com/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/releases/latest/download/manifest.json`;
}
