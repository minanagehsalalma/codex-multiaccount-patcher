import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { commandInstall, commandStatus } from "../src/lib/commands.js";
import { appDirs, defaultManifestUrl } from "../src/lib/constants.js";
import { createLocalManifestRecord, findManifestRecord, loadManifest } from "../src/lib/manifest.js";
import { loadState, saveState } from "../src/lib/state.js";
import { sha256File, writeJson } from "../src/lib/util.js";

test("local overlay installs stay local-only and keep a matching local manifest record", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-multiaccount-install-"));
  try {
    const upstreamPath = path.join(tempRoot, "upstream-codex");
    const overlayPath = path.join(tempRoot, "overlay-codex");
    await fs.writeFile(upstreamPath, "upstream-binary", { mode: 0o755 });
    await fs.writeFile(overlayPath, "patched-binary", { mode: 0o755 });

    const context = {
      cwd: tempRoot,
      homeDir: tempRoot,
      platform: "linux",
      arch: "x64",
      projectRoot: tempRoot,
      execPath: process.execPath,
    };

    await commandInstall(context, {
      path: upstreamPath,
      overlayPath,
    });

    const dirs = appDirs(tempRoot);
    const state = await loadState(dirs.statePath);
    assert.equal(state.manifestSource, null);
    const manifest = await loadManifest(dirs.manifestPath);
    assert.ok(findManifestRecord(manifest, state.lastKnownUpstreamSha256, context.platform, context.arch));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("manifest-backed installs keep their manifest source", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-multiaccount-manifest-"));
  try {
    const upstreamPath = path.join(tempRoot, "upstream-codex");
    const overlayPath = path.join(tempRoot, "overlay-codex");
    const manifestPath = path.join(tempRoot, "manifest.json");
    await fs.writeFile(upstreamPath, "upstream-binary", { mode: 0o755 });
    await fs.writeFile(overlayPath, "patched-binary", { mode: 0o755 });

    const context = {
      cwd: tempRoot,
      homeDir: tempRoot,
      platform: "linux",
      arch: "x64",
      projectRoot: tempRoot,
      execPath: process.execPath,
    };

    const upstreamSha256 = await sha256File(upstreamPath);
    const overlaySha256 = await sha256File(overlayPath);
    const record = createLocalManifestRecord({
      codexVersion: "0.118.0",
      platform: context.platform,
      arch: context.arch,
      upstreamBinaryPath: upstreamPath,
      upstreamSha256,
      overlaySourcePath: overlayPath,
      overlaySourceSha256: overlaySha256,
      managedOverlayPath: null,
    });
    await writeJson(manifestPath, {
      schemaVersion: 1,
      records: [record],
    });

    await commandInstall(context, {
      path: upstreamPath,
      manifest: manifestPath,
    });

    const dirs = appDirs(tempRoot);
    const state = await loadState(dirs.statePath);
    assert.equal(state.manifestSource, manifestPath);
    const manifest = await loadManifest(dirs.manifestPath);
    assert.ok(findManifestRecord(manifest, state.lastKnownUpstreamSha256, context.platform, context.arch));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("install reuses the existing managed overlay when the upstream hash changes on the same binary path", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-multiaccount-reuse-install-"));
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(JSON.stringify({ schemaVersion: 1, records: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const upstreamPath = path.join(tempRoot, "upstream-codex");
    const managedOverlayPath = path.join(tempRoot, ".codex-multiaccount", "overlays", "existing", "codex");
    await fs.writeFile(upstreamPath, "repacked-upstream-binary", { mode: 0o755 });
    await fs.mkdir(path.dirname(managedOverlayPath), { recursive: true });
    await fs.writeFile(managedOverlayPath, "known-good-overlay", { mode: 0o755 });

    const context = {
      cwd: tempRoot,
      homeDir: tempRoot,
      platform: "linux",
      arch: "x64",
      projectRoot: tempRoot,
      execPath: process.execPath,
    };

    const dirs = appDirs(tempRoot);
    const previousOverlaySha256 = await sha256File(managedOverlayPath);
    await saveState(dirs.statePath, {
      installedAt: new Date().toISOString(),
      managedBinDir: dirs.binDir,
      manifestPath: dirs.manifestPath,
      manifestSource: defaultManifestUrl(),
      currentRecordId: "previous-record",
      upstream: {
        version: "0.121.0",
        vendorBinaryPath: upstreamPath,
      },
      lastKnownUpstreamSha256: "old-hash",
      overlay: {
        sourcePath: managedOverlayPath,
        sourceSha256: previousOverlaySha256,
        managedPath: managedOverlayPath,
      },
    });

    await commandInstall(context, {
      path: upstreamPath,
    });

    const state = await loadState(dirs.statePath);
    const manifest = await loadManifest(dirs.manifestPath);
    const currentUpstreamSha256 = await sha256File(upstreamPath);
    const record = findManifestRecord(manifest, currentUpstreamSha256, context.platform, context.arch);

    assert.equal(state.overlay.managedPath, managedOverlayPath);
    assert.equal(state.manifestSource, defaultManifestUrl());
    assert.ok(record);
    assert.equal(record.managedOverlayPath, managedOverlayPath);
    assert.equal(record.overlaySourcePath, managedOverlayPath);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("status self-heals to the installed managed overlay when the cached manifest no longer matches", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-multiaccount-reuse-status-"));
  try {
    const upstreamPath = path.join(tempRoot, "upstream-codex");
    const managedOverlayPath = path.join(tempRoot, ".codex-multiaccount", "overlays", "existing", "codex");
    await fs.writeFile(upstreamPath, "repacked-upstream-binary", { mode: 0o755 });
    await fs.mkdir(path.dirname(managedOverlayPath), { recursive: true });
    await fs.writeFile(managedOverlayPath, "known-good-overlay", { mode: 0o755 });

    const context = {
      cwd: tempRoot,
      homeDir: tempRoot,
      platform: "linux",
      arch: "x64",
      projectRoot: tempRoot,
      execPath: process.execPath,
    };

    const dirs = appDirs(tempRoot);
    const currentUpstreamSha256 = await sha256File(upstreamPath);
    const previousOverlaySha256 = await sha256File(managedOverlayPath);

    await writeJson(dirs.manifestPath, {
      schemaVersion: 1,
      records: [
        {
          id: "stale-record",
          codexVersion: "0.121.0",
          platform: context.platform,
          arch: context.arch,
          upstreamSha256: "stale-hash",
          managedOverlayPath,
        },
      ],
    });
    await saveState(dirs.statePath, {
      installedAt: new Date().toISOString(),
      managedBinDir: dirs.binDir,
      manifestPath: dirs.manifestPath,
      manifestSource: null,
      currentRecordId: "stale-record",
      upstream: {
        version: "0.121.0",
        vendorBinaryPath: upstreamPath,
      },
      lastKnownUpstreamSha256: "stale-hash",
      overlay: {
        sourcePath: managedOverlayPath,
        sourceSha256: previousOverlaySha256,
        managedPath: managedOverlayPath,
      },
    });

    const { stdout } = await captureStdout(() => commandStatus(context));
    const manifest = await loadManifest(dirs.manifestPath);
    const record = findManifestRecord(manifest, currentUpstreamSha256, context.platform, context.arch);
    const state = await loadState(dirs.statePath);

    assert.match(stdout, /supported: yes/);
    assert.ok(record);
    assert.equal(record.managedOverlayPath, managedOverlayPath);
    assert.equal(state.currentRecordId, record.id);
    assert.equal(state.lastKnownUpstreamSha256, currentUpstreamSha256);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

function captureStdout(run) {
  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk, encoding, callback) => {
    stdout += chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : String(chunk);
    if (typeof encoding === "function") {
      encoding();
    } else if (typeof callback === "function") {
      callback();
    }
    return true;
  });
  return Promise.resolve()
    .then(run)
    .then(
      (value) => {
        process.stdout.write = originalWrite;
        return { value, stdout };
      },
      (error) => {
        process.stdout.write = originalWrite;
        throw error;
      },
    );
}
