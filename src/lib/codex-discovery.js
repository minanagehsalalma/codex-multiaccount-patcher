import path from "node:path";
import { promises as fs } from "node:fs";
import process from "node:process";

import { codexExecutableName, equalsPath, pathExists, platformLabel, readJson, runCommand } from "./util.js";

const PLATFORM_PACKAGE_BY_TARGET = {
  "linux-x64": {
    optionalDependency: "@openai/codex-linux-x64",
    vendorTriple: "x86_64-unknown-linux-musl",
  },
  "linux-arm64": {
    optionalDependency: "@openai/codex-linux-arm64",
    vendorTriple: "aarch64-unknown-linux-musl",
  },
  "darwin-x64": {
    optionalDependency: "@openai/codex-darwin-x64",
    vendorTriple: "x86_64-apple-darwin",
  },
  "darwin-arm64": {
    optionalDependency: "@openai/codex-darwin-arm64",
    vendorTriple: "aarch64-apple-darwin",
  },
  "win32-x64": {
    optionalDependency: "@openai/codex-win32-x64",
    vendorTriple: "x86_64-pc-windows-msvc",
  },
  "win32-arm64": {
    optionalDependency: "@openai/codex-win32-arm64",
    vendorTriple: "aarch64-pc-windows-msvc",
  },
};

export async function discoverCodexInstall(context, explicitBinaryPath) {
  if (explicitBinaryPath) {
    return {
      discoveryMethod: "explicit",
      version: null,
      packageRoot: null,
      vendorPackageRoot: path.dirname(path.dirname(explicitBinaryPath)),
      vendorTriple: null,
      vendorBinaryPath: explicitBinaryPath,
      pathDir: null,
      shimsDir: null,
    };
  }

  const npmRoot = await discoverGlobalNpmRoot();
  const cliPackageRoot = path.join(npmRoot, "@openai", "codex");
  if (!(await pathExists(path.join(cliPackageRoot, "package.json")))) {
    throw new Error(`@openai/codex not found under npm root: ${npmRoot}`);
  }

  const cliPackage = await readJson(path.join(cliPackageRoot, "package.json"));
  const targetInfo = PLATFORM_PACKAGE_BY_TARGET[platformLabel(context.platform, context.arch)];
  if (!targetInfo) {
    throw new Error(`unsupported platform: ${context.platform}/${context.arch}`);
  }
  const vendorPackageRoot = path.join(cliPackageRoot, "node_modules", "@openai", targetInfo.optionalDependency.replace("@openai/", ""));
  const vendorBinaryPath = path.join(
    vendorPackageRoot,
    "vendor",
    targetInfo.vendorTriple,
    "codex",
    codexExecutableName(context.platform),
  );
  if (!(await pathExists(vendorBinaryPath))) {
    throw new Error(`Codex vendor binary not found: ${vendorBinaryPath}`);
  }

  const pathDir = path.join(vendorPackageRoot, "vendor", targetInfo.vendorTriple, "path");
  const shimsDir =
    context.platform === "win32"
      ? path.join(context.homeDir, "AppData", "Roaming", "npm")
      : path.join(context.homeDir, ".local", "bin");

  return {
    discoveryMethod: "npm-global",
    version: cliPackage.version,
    packageRoot: cliPackageRoot,
    vendorPackageRoot,
    vendorTriple: targetInfo.vendorTriple,
    vendorBinaryPath,
    pathDir: (await pathExists(pathDir)) ? pathDir : null,
    shimsDir,
  };
}

export async function discoverGlobalNpmRoot() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? "", "AppData", "Roaming"), "npm", "node_modules");
  }
  const npmCommand = "npm";
  const result = await runCommand(npmCommand, ["root", "-g"]);
  if (result.code !== 0) {
    throw new Error(`failed to resolve npm global root: ${result.stderr || result.stdout}`.trim());
  }
  return result.stdout.trim();
}

export async function autoDetectOverlayPath(context, upstreamBinaryPath) {
  const candidateDirectories = [
    path.join(context.projectRoot, "dist", "overlay"),
    path.join(context.projectRoot, "dist", "overlays"),
    path.join(context.cwd, "dist", "overlay"),
    path.join(context.cwd, "dist", "overlays"),
    path.join(context.homeDir, "codex-patched"),
  ];
  const executableName = codexExecutableName(context.platform);
  const overlays = [];

  for (const directory of candidateDirectories) {
    if (!(await pathExists(directory))) {
      continue;
    }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const candidate = path.join(directory, entry.name);
      const isLikelyOverlay =
        entry.name === executableName ||
        entry.name.startsWith("codex-") ||
        entry.name.includes("hotpatch") ||
        entry.name.includes("patched");
      if (!isLikelyOverlay || equalsPath(candidate, upstreamBinaryPath)) {
        continue;
      }
      const stats = await fs.stat(candidate);
      overlays.push({ candidate, modifiedTime: stats.mtimeMs });
    }
  }

  overlays.sort((left, right) => right.modifiedTime - left.modifiedTime);
  return overlays[0]?.candidate ?? null;
}
