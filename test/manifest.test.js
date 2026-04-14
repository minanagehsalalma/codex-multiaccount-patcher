import test from "node:test";
import assert from "node:assert/strict";

import { createLocalManifestRecord, findManifestRecord, validateManifest } from "../src/lib/manifest.js";

test("findManifestRecord returns exact platform+hash match", () => {
  const record = createLocalManifestRecord({
    codexVersion: "0.118.0",
    platform: "win32",
    arch: "x64",
    upstreamBinaryPath: "C:\\codex.exe",
    upstreamSha256: "abc123",
    overlaySourcePath: "C:\\patched.exe",
    overlaySourceSha256: "def456",
    managedOverlayPath: "C:\\managed\\patched.exe",
  });
  const manifest = { schemaVersion: 1, records: [record] };

  assert.equal(findManifestRecord(manifest, "abc123", "win32", "x64")?.id, record.id);
  assert.equal(findManifestRecord(manifest, "abc123", "linux", "x64"), null);
  assert.equal(findManifestRecord(manifest, "nope", "win32", "x64"), null);
});

test("validateManifest accepts remote overlay records", () => {
  const manifest = {
    schemaVersion: 1,
    records: [
      {
        id: "record-1",
        platform: "win32",
        arch: "x64",
        upstreamSha256: "abc123",
        overlayUrl: "https://example.com/codex.exe",
      },
    ],
  };

  assert.doesNotThrow(() => validateManifest(manifest));
});
