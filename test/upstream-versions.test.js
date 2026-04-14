import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVersionMatrix,
  normalizeExplicitVersions,
  resolveStableVersions,
} from "../src/lib/upstream-versions.js";

test("resolveStableVersions filters prereleases and platform variants before sorting", () => {
  const versions = resolveStableVersions(
    [
      "0.120.0-win32-x64",
      "0.120.0",
      "0.121.0-alpha.1",
      "0.118.0",
      "0.119.0-linux-x64",
      "0.119.0",
      "0.117.0",
    ],
    { count: 3, minVersion: "0.118.0" },
  );

  assert.deepEqual(versions, ["0.120.0", "0.119.0", "0.118.0"]);
});

test("normalizeExplicitVersions accepts tags and bare versions", () => {
  assert.deepEqual(normalizeExplicitVersions("rust-v0.120.0, v0.119.0,0.118.0"), [
    "0.120.0",
    "0.119.0",
    "0.118.0",
  ]);
});

test("buildVersionMatrix creates fast and full target matrices", () => {
  const fast = buildVersionMatrix(["0.120.0"], { targetSet: "fast" });
  assert.equal(fast.length, 1);
  assert.equal(fast[0].os, "ubuntu-latest");
  assert.equal(fast[0].codex_ref, "rust-v0.120.0");

  const full = buildVersionMatrix(["0.120.0"], { targetSet: "full" });
  assert.equal(full.length, 2);
  assert.deepEqual(
    full.map((entry) => entry.os).sort(),
    ["ubuntu-latest", "windows-latest"],
  );
});
