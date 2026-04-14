import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { autoDetectOverlayPath } from "../src/lib/codex-discovery.js";

test("autoDetectOverlayPath prefers the newest generic overlay candidate", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-hotpatch-discovery-"));
  const projectRoot = path.join(tempRoot, "project");
  const homeDir = path.join(tempRoot, "home");
  const cwd = path.join(tempRoot, "cwd");
  await fs.mkdir(path.join(projectRoot, "dist", "overlay"), { recursive: true });
  await fs.mkdir(path.join(homeDir, "codex-patched"), { recursive: true });
  await fs.mkdir(path.join(cwd, "dist", "overlay"), { recursive: true });

  const olderOverlay = path.join(homeDir, "codex-patched", "codex-patched.exe");
  const newerOverlay = path.join(cwd, "dist", "overlay", "codex-0.120.0-hotpatch.exe");
  const upstreamBinaryPath = path.join(tempRoot, "upstream", "codex.exe");
  await fs.mkdir(path.dirname(upstreamBinaryPath), { recursive: true });
  await fs.writeFile(olderOverlay, "older", "utf8");
  await fs.writeFile(newerOverlay, "newer", "utf8");
  await fs.writeFile(upstreamBinaryPath, "upstream", "utf8");

  const earlier = new Date("2026-04-14T00:00:00.000Z");
  const later = new Date("2026-04-14T00:05:00.000Z");
  await fs.utimes(olderOverlay, earlier, earlier);
  await fs.utimes(newerOverlay, later, later);

  const detected = await autoDetectOverlayPath(
    {
      platform: "win32",
      homeDir,
      projectRoot,
      cwd,
    },
    upstreamBinaryPath,
  );

  assert.equal(detected, newerOverlay);
});

test("autoDetectOverlayPath ignores the upstream binary itself", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-hotpatch-discovery-"));
  const projectRoot = path.join(tempRoot, "project");
  const upstreamDir = path.join(projectRoot, "dist", "overlay");
  await fs.mkdir(upstreamDir, { recursive: true });

  const upstreamBinaryPath = path.join(upstreamDir, "codex.exe");
  await fs.writeFile(upstreamBinaryPath, "same-file", "utf8");

  const detected = await autoDetectOverlayPath(
    {
      platform: "win32",
      homeDir: path.join(tempRoot, "home"),
      projectRoot,
      cwd: path.join(tempRoot, "cwd"),
    },
    upstreamBinaryPath,
  );

  assert.equal(detected, null);
});
