import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

import { appDirs, defaultManifestUrl, PRIMARY_CLI_NAME } from "./constants.js";
import { captureAuthCli, inspectAuthCli } from "./auth-cli.js";
import { discoverCodexInstall, autoDetectOverlayPath } from "./codex-discovery.js";
import {
  createLocalManifestRecord,
  deleteManifest,
  findManifestRecord,
  loadManifest,
  saveManifest,
  withManagedOverlayPath,
} from "./manifest.js";
import { ensureManagedOverlay } from "./overlay.js";
import { ensureManagedBinOnUserPath, removeManagedBinFromUserPath } from "./path-env.js";
import { deleteState, loadState, saveState } from "./state.js";
import { removeManagedShims, writeManagedShims } from "./shims.js";
import { ensureDir, pathExists, readJson, sha256File, writeJson } from "./util.js";

function splitWindowsPathList(value) {
  return String(value ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeWindowsPathLists(...values) {
  const seen = new Set();
  const merged = [];
  for (const value of values) {
    for (const entry of splitWindowsPathList(value)) {
      const key = entry.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged.join(";");
}

function readWindowsPath(scope) {
  const powershellPath = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  try {
    return execFileSync(
      powershellPath,
      [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        `[Environment]::GetEnvironmentVariable('Path','${scope}')`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

export async function commandInstall(context, options) {
  const dirs = appDirs(context.homeDir);
  await migrateLegacyRuntime(dirs);
  await ensureDir(dirs.rootDir);
  await ensureDir(dirs.overlaysDir);
  await ensureDir(dirs.manifestsDir);

  const explicitUpstreamPath = resolveLocalPathOption(context, options.path);
  const upstream = await discoverCodexInstall(context, explicitUpstreamPath);
  const upstreamSha256 = await sha256File(upstream.vendorBinaryPath);

  let manifest;
  let manifestSource = resolvePathOrUrlOption(context, options.manifest) ?? defaultManifestUrl();
  let overlaySourcePath = resolveLocalPathOption(context, options.overlayPath);
  let activeRecord = null;
  let manifestLoadError = null;
  if (!overlaySourcePath) {
    try {
      manifest = await loadManifest(manifestSource);
      activeRecord = findManifestRecord(manifest, upstreamSha256, context.platform, context.arch);
      if (options.manifest && !activeRecord) {
        throw new Error(`no manifest record matches upstream hash ${upstreamSha256}`);
      }
    } catch (error) {
      if (options.manifest) {
        throw error;
      }
      manifestLoadError = error;
      manifest = null;
      activeRecord = null;
      manifestSource = null;
    }
  }

  if (!activeRecord && !overlaySourcePath) {
    overlaySourcePath = await autoDetectOverlayPath(context, upstream.vendorBinaryPath);
  }
  if (!activeRecord && !overlaySourcePath) {
    if (manifestLoadError) {
      throw new Error(
        `no compatible published overlay is available yet and no local overlay was auto-detected. Default manifest lookup failed: ${manifestLoadError.message}`,
      );
    }
    throw new Error(
      `no compatible published overlay is available yet and no local overlay was auto-detected. Pass --manifest <file-or-url> or --overlay-path <path>.`,
    );
  }
  if (overlaySourcePath && !(await pathExists(overlaySourcePath))) {
    throw new Error(`overlay binary not found: ${overlaySourcePath}`);
  }

  if (!activeRecord) {
    const overlaySourceSha256 = await sha256File(overlaySourcePath);
    activeRecord = createLocalManifestRecord({
      codexVersion: upstream.version,
      platform: context.platform,
      arch: context.arch,
      upstreamBinaryPath: upstream.vendorBinaryPath,
      upstreamSha256,
      overlaySourcePath,
      overlaySourceSha256,
      managedOverlayPath: null,
    });
    manifest = { schemaVersion: 1, records: [activeRecord] };
  }

  const overlay = await ensureManagedOverlay(context, dirs, activeRecord);
  const hydratedRecord = withManagedOverlayPath(activeRecord, overlay.managedOverlayPath, overlay.overlaySha256);
  const manifestRecords = manifest.records.map((record) =>
    record.id === activeRecord.id ? hydratedRecord : record,
  );
  await saveManifest(dirs.manifestPath, manifestRecords);

  await writeManagedShims(context, dirs.binDir);
  await ensureManagedBinOnUserPath(context, dirs.binDir, [dirs.legacy.binDir]);

  const state = {
    installedAt: new Date().toISOString(),
    managedBinDir: dirs.binDir,
    manifestPath: dirs.manifestPath,
    manifestSource,
    currentRecordId: hydratedRecord.id,
    upstream,
    lastKnownUpstreamSha256: upstreamSha256,
    overlay: {
      sourcePath: hydratedRecord.overlaySourcePath ?? null,
      sourceSha256: overlay.overlaySha256,
      managedPath: overlay.managedOverlayPath,
    },
  };
  await saveState(dirs.statePath, state);

  process.stdout.write(`Installed multiaccount overlay for Codex ${upstream.version ?? "unknown"}.\n`);
  process.stdout.write(`Managed shim dir: ${dirs.binDir}\n`);
  process.stdout.write(`Managed overlay: ${overlay.managedOverlayPath}\n`);
}

export async function commandStatus(context) {
  const { dirs, state } = await loadInstalledRuntime(appDirs(context.homeDir));
  if (!state) {
    process.stdout.write("status: not installed\n");
    return;
  }

  const manifest = await loadManifest(state.manifestPath);
  const currentUpstream = await discoverCurrentUpstream(context, state);
  const currentUpstreamSha256 = await sha256File(currentUpstream.vendorBinaryPath);
  const { record } = await resolveRecord(context, dirs, state, manifest, currentUpstream, currentUpstreamSha256);
  const overlayPresent = await pathExists(state.overlay.managedPath);

  const lines = [
    `status: installed`,
    `upstream: ${currentUpstream.vendorBinaryPath}`,
    `upstream-sha256: ${currentUpstreamSha256}`,
    `overlay: ${state.overlay.managedPath}`,
    `overlay-present: ${overlayPresent ? "yes" : "no"}`,
    `supported: ${record ? "yes" : "no"}`,
    `manifest: ${state.manifestPath}`,
    `manifest-source: ${state.manifestSource ?? "local-only"}`,
    `managed-bin: ${state.managedBinDir}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export async function commandDoctor(context) {
  const dirs = appDirs(context.homeDir);
  const { state } = await loadInstalledRuntime(dirs);
  const auth = await inspectAuthCli(context);

  const lines = [
    `toolkit-home: ${dirs.rootDir}`,
    `codex-home: ${auth.codexHome}`,
  ];

  let patchHealthy = false;
  if (!state) {
    lines.push("patch: not installed");
  } else {
    const manifestPresent = await pathExists(state.manifestPath);
    const overlayPresent = await pathExists(state.overlay.managedPath);
    let supported = false;
    let upstreamPath = state.upstream.vendorBinaryPath;
    try {
      const upstream = await discoverCurrentUpstream(context, state);
      upstreamPath = upstream.vendorBinaryPath;
      const upstreamSha256 = await sha256File(upstream.vendorBinaryPath);
      const manifest = await loadCachedManifest(state.manifestPath);
      const { record } = await resolveRecord(context, dirs, state, manifest, upstream, upstreamSha256);
      supported = Boolean(record);
      patchHealthy = manifestPresent && overlayPresent && supported;
      lines.push("patch: installed");
      lines.push(`patch-upstream: ${upstreamPath}`);
      lines.push(`patch-overlay: ${state.overlay.managedPath}`);
      lines.push(`patch-manifest: ${manifestPresent ? "present" : "missing"}`);
      lines.push(`patch-overlay-present: ${overlayPresent ? "yes" : "no"}`);
      lines.push(`patch-supported: ${supported ? "yes" : "no"}`);
    } catch (error) {
      lines.push("patch: error");
      lines.push(`patch-upstream: ${upstreamPath}`);
      lines.push(`patch-error: ${error.message}`);
    }
  }

  const accountsDirExists = await pathExists(auth.accountsDir);
  const registryExists = await pathExists(auth.registryPath);
  const activeAuthExists = await pathExists(auth.activeAuthPath);
  lines.push(`auth-source: ${auth.source}`);
  lines.push(`auth-entrypoint: ${auth.entrypoint}`);
  lines.push(`auth-accounts-dir: ${auth.accountsDir}`);
  lines.push(`auth-accounts-present: ${accountsDirExists ? "yes" : "no"}`);
  lines.push(`auth-registry: ${registryExists ? "present" : "missing"}`);
  lines.push(`auth-active-auth: ${activeAuthExists ? "present" : "missing"}`);

  let authHealthy = false;
  try {
    const authStatus = await captureAuthCli(context, ["status"]);
    authHealthy = authStatus.code === 0 && registryExists && activeAuthExists;
    lines.push(`auth-status-exit: ${authStatus.code}`);
    for (const line of authStatus.stdout.split(/\r?\n/).filter(Boolean)) {
      lines.push(`auth-status-${line}`);
    }
    if (authStatus.stderr.trim()) {
      for (const line of authStatus.stderr.split(/\r?\n/).filter(Boolean)) {
        lines.push(`auth-stderr-${line}`);
      }
    }
  } catch (error) {
    lines.push("auth-status-exit: error");
    lines.push(`auth-error: ${error.message}`);
  }

  const overall = patchHealthy && authHealthy ? "ok" : state || authHealthy ? "warn" : "fail";
  process.stdout.write(`doctor: ${overall}\n${lines.join("\n")}\n`);
  if (overall !== "ok") {
    process.exitCode = 1;
  }
}

export async function commandRepair(context) {
  const { dirs, state } = await loadInstalledRuntime(appDirs(context.homeDir));
  if (!state) {
    throw new Error("multiaccount patcher is not installed");
  }

  await ensureDir(dirs.rootDir);
  await ensureDir(dirs.overlaysDir);
  await ensureDir(dirs.manifestsDir);

  const upstream = await discoverCurrentUpstream(context, state);
  const upstreamSha256 = await sha256File(upstream.vendorBinaryPath);
  const manifest = await loadCachedManifest(state.manifestPath);
  const { record, manifestRecords } = await resolveRecord(context, dirs, state, manifest, upstream, upstreamSha256);
  if (!record) {
    throw new Error(`no compatible overlay record found for upstream hash ${upstreamSha256}`);
  }
  const overlay = await ensureManagedOverlay(context, dirs, record);
  const hydratedRecord = withManagedOverlayPath(record, overlay.managedOverlayPath, overlay.overlaySha256);
  await saveManifest(
    dirs.manifestPath,
    manifestRecords.map((item) => (item.id === hydratedRecord.id ? hydratedRecord : item)),
  );
  await updateStateForRecord(dirs, state, upstream, upstreamSha256, hydratedRecord, overlay);

  await writeManagedShims(context, dirs.binDir);
  await ensureManagedBinOnUserPath(context, dirs.binDir, [dirs.legacy.binDir]);
  process.stdout.write("repair: complete\n");
}

export async function commandUninstall(context) {
  const { dirs, state } = await loadInstalledRuntime(appDirs(context.homeDir));
  if (!state) {
    process.stdout.write("uninstall: nothing to do\n");
    return;
  }

  await removeManagedShims(context, dirs.binDir);
  await removeManagedBinFromUserPath(context, [dirs.binDir, dirs.legacy.binDir]);
  await deleteManifest(state.manifestPath);
  await deleteState(dirs.statePath);
  process.stdout.write("uninstall: complete\n");
}

export async function commandLaunch(context, passthroughArgs) {
  const { dirs, state } = await loadInstalledRuntime(appDirs(context.homeDir));
  if (!state) {
    throw new Error("multiaccount patcher is not installed");
  }

  const upstream = await discoverCurrentUpstream(context, state);
  const upstreamSha256 = await sha256File(upstream.vendorBinaryPath);
  const manifest = await loadCachedManifest(state.manifestPath);
  const { record, manifestRecords } = await resolveRecord(context, dirs, state, manifest, upstream, upstreamSha256);
  if (!record) {
    throw new Error(
      `current upstream Codex hash is unsupported. Expected a manifest record for ${upstreamSha256}. Run ${PRIMARY_CLI_NAME} install again with a compatible overlay.`,
    );
  }
  const overlay = await ensureManagedOverlay(context, dirs, record);
  const hydratedRecord = withManagedOverlayPath(record, overlay.managedOverlayPath, overlay.overlaySha256);
  await saveManifest(
    dirs.manifestPath,
    manifestRecords.map((item) => (item.id === hydratedRecord.id ? hydratedRecord : item)),
  );
  await updateStateForRecord(dirs, state, upstream, upstreamSha256, hydratedRecord, overlay);

  const env = { ...process.env };
  if (context.platform === "win32") {
    const userPath = readWindowsPath("User");
    const machinePath = readWindowsPath("Machine");
    const mergedPath = mergeWindowsPathLists(userPath, machinePath, env.PATH, env.Path);
    env.PATH = mergedPath;
    env.Path = mergedPath;
  }
  const pathEntries = [];
  if (upstream.pathDir && (await pathExists(upstream.pathDir))) {
    pathEntries.push(upstream.pathDir);
  }
  const overlayPathDir = path.join(path.dirname(hydratedRecord.managedOverlayPath), "path");
  if (await pathExists(overlayPathDir)) {
    pathEntries.push(overlayPathDir);
  }
  if (pathEntries.length > 0) {
    const delimiter = context.platform === "win32" ? ";" : ":";
    env.PATH = `${pathEntries.join(delimiter)}${delimiter}${env.PATH ?? env.Path ?? ""}`;
    if (context.platform === "win32") {
      env.Path = env.PATH;
    }
  }

  const child = spawn(hydratedRecord.managedOverlayPath, passthroughArgs, {
    stdio: "inherit",
    env,
    windowsHide: true,
  });

  child.on("error", (error) => {
    process.stderr.write(`error: failed to launch overlay: ${error.message}\n`);
    process.exit(1);
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch {
        // ignore
      }
    }
  };

  ["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
    process.on(signal, () => forwardSignal(signal));
  });

  const outcome = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  if (outcome.signal) {
    process.kill(process.pid, outcome.signal);
    return;
  }
  process.exit(outcome.code ?? 1);
}

async function resolveRecord(context, dirs, state, cachedManifest, upstream, upstreamSha256) {
  let manifest = cachedManifest;
  if (state.manifestSource) {
    try {
      manifest = await loadManifest(state.manifestSource);
    } catch (error) {
      if (!cachedManifest) {
        throw error;
      }
    }
  }
  if (!manifest) {
    return { manifestRecords: [], record: null };
  }
  const record = findManifestRecord(manifest, upstreamSha256, context.platform, context.arch);
  const manifestRecords = manifest.records;
  if (state.manifestSource) {
    await saveManifest(dirs.manifestPath, manifestRecords);
  }
  return { manifestRecords, record };
}

async function loadCachedManifest(manifestPath) {
  if (!(await pathExists(manifestPath))) {
    return null;
  }
  return loadManifest(manifestPath);
}

async function loadInstalledRuntime(dirs) {
  await migrateLegacyRuntime(dirs);

  const primaryState = await loadState(dirs.statePath);
  if (primaryState) {
    return { dirs, state: primaryState };
  }

  const legacyState = await loadState(dirs.legacy.statePath);
  if (!legacyState) {
    return { dirs, state: null };
  }

  return {
    dirs: {
      ...dirs,
      rootDir: dirs.legacy.rootDir,
      binDir: dirs.legacy.binDir,
      overlaysDir: dirs.legacy.overlaysDir,
      manifestsDir: dirs.legacy.manifestsDir,
      statePath: dirs.legacy.statePath,
      manifestPath: dirs.legacy.manifestPath,
    },
    state: legacyState,
  };
}

async function migrateLegacyRuntime(dirs) {
  if (await pathExists(dirs.statePath)) {
    return;
  }
  if (!(await pathExists(dirs.legacy.rootDir)) || (await pathExists(dirs.rootDir))) {
    return;
  }

  await fs.rename(dirs.legacy.rootDir, dirs.rootDir);

  if (await pathExists(dirs.statePath)) {
    const state = await loadState(dirs.statePath);
    if (state) {
      await saveState(dirs.statePath, rewritePathPrefixes(state, dirs.legacy.rootDir, dirs.rootDir));
    }
  }
  if (await pathExists(dirs.manifestPath)) {
    const manifest = await readJson(dirs.manifestPath);
    await writeJson(dirs.manifestPath, rewritePathPrefixes(manifest, dirs.legacy.rootDir, dirs.rootDir));
  }
}

function rewritePathPrefixes(value, fromPrefix, toPrefix) {
  if (typeof value === "string") {
    return value.startsWith(fromPrefix) ? path.join(toPrefix, path.relative(fromPrefix, value)) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewritePathPrefixes(item, fromPrefix, toPrefix));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewritePathPrefixes(item, fromPrefix, toPrefix)]),
    );
  }
  return value;
}

async function updateStateForRecord(dirs, state, upstream, upstreamSha256, record, overlay) {
  const nextState = {
    ...state,
    manifestPath: dirs.manifestPath,
    currentRecordId: record.id,
    upstream,
    lastKnownUpstreamSha256: upstreamSha256,
    overlay: {
      sourcePath: record.overlaySourcePath ?? null,
      sourceSha256: overlay.overlaySha256,
      managedPath: overlay.managedOverlayPath,
    },
  };
  await saveState(dirs.statePath, nextState);
}

async function discoverCurrentUpstream(context, state) {
  try {
    return await discoverCodexInstall(context);
  } catch (error) {
    if (state?.upstream?.vendorBinaryPath) {
      return discoverCodexInstall(context, state.upstream.vendorBinaryPath);
    }
    throw error;
  }
}

function resolveLocalPathOption(context, value) {
  if (!value) {
    return null;
  }
  return path.isAbsolute(value) ? value : path.resolve(context.cwd, value);
}

function resolvePathOrUrlOption(context, value) {
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return resolveLocalPathOption(context, value);
}
