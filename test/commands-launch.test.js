import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { commandLaunch } from "../src/lib/commands.js";
import { appDirs } from "../src/lib/constants.js";
import { saveState } from "../src/lib/state.js";
import { writeJson } from "../src/lib/util.js";

test("commandLaunch falls back to the stock upstream binary when no overlay matches", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-multiaccount-launch-"));
  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = path.join(tempRoot, "AppData", "Roaming");

  const captureFile = path.join(tempRoot, "upstream-capture.json");
  const upstreamPath = process.execPath;

  const context = {
    cwd: tempRoot,
    homeDir: tempRoot,
    platform: "win32",
    arch: "x64",
    projectRoot: tempRoot,
    execPath: process.execPath,
  };

  const dirs = appDirs(tempRoot);
  await writeJson(dirs.manifestPath, { schemaVersion: 1, records: [] });
  await saveState(dirs.statePath, {
    installedAt: new Date().toISOString(),
    managedBinDir: dirs.binDir,
    manifestPath: dirs.manifestPath,
    manifestSource: null,
    currentRecordId: null,
    upstream: {
      version: "0.121.0",
      vendorBinaryPath: upstreamPath,
    },
    lastKnownUpstreamSha256: "stale-hash",
    overlay: {
      sourcePath: null,
      sourceSha256: null,
      managedPath: path.join(tempRoot, "missing-overlay.exe"),
    },
  });

  let stderr = "";
  const originalExit = process.exit;
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = ((chunk, encoding, callback) => {
    stderr += chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : String(chunk);
    if (typeof encoding === "function") {
      encoding();
    } else if (typeof callback === "function") {
      callback();
    }
    return true;
  });

  try {
    process.exit = ((code) => {
      throw new Error(`EXIT:${code ?? 0}`);
    });
    await assert.rejects(
      () =>
        commandLaunch(context, [
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(captureFile)}, JSON.stringify('fallback-ran'))`,
        ]),
      /EXIT:0/,
    );
    const capturedArgs = JSON.parse(await fs.readFile(captureFile, "utf8"));
    assert.equal(capturedArgs, "fallback-ran");
    assert.match(stderr, /Launching the stock Codex binary until support lands/i);
  } finally {
    process.exit = originalExit;
    process.stderr.write = originalStderrWrite;
    process.env.APPDATA = previousAppData;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
