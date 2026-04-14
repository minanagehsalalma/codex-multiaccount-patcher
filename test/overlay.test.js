import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { ensureManagedOverlay, resolveManagedOverlayPath } from "../src/lib/overlay.js";

test("ensureManagedOverlay copies a local overlay into the managed cache", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-hotpatch-overlay-"));
  const sourcePath = path.join(tempRoot, "patched.exe");
  const dirs = { overlaysDir: path.join(tempRoot, "managed") };
  await fs.writeFile(sourcePath, "patched-binary", "utf8");

  const result = await ensureManagedOverlay(
    { platform: "win32" },
    dirs,
    {
      id: "record-1",
      overlaySourcePath: sourcePath,
      overlaySha256: null,
      overlayFilename: "patched.exe",
    },
  );

  assert.equal(path.basename(result.managedOverlayPath), "patched.exe");
  assert.equal(await fs.readFile(result.managedOverlayPath, "utf8"), "patched-binary");

  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("resolveManagedOverlayPath uses hash buckets when no managed path exists", () => {
  const resolved = resolveManagedOverlayPath(
    { platform: "linux" },
    { overlaysDir: "/tmp/overlays" },
    {
      overlaySha256: "abc123",
      overlayFilename: "codex",
    },
  );

  assert.equal(resolved, path.join("/tmp/overlays", "abc123", "codex"));
});
