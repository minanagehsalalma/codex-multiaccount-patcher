import test from "node:test";
import assert from "node:assert/strict";

import { normalizePathList, renderPathList, uniquePaths } from "../src/lib/util.js";

test("windows path helpers preserve order and remove duplicates", () => {
  const entries = normalizePathList("C:\\A;C:\\B;C:\\A", "win32");
  assert.deepEqual(entries, ["C:\\A", "C:\\B", "C:\\A"]);
  assert.deepEqual(uniquePaths(entries), ["C:\\A", "C:\\B"]);
  assert.equal(renderPathList(["C:\\X", "C:\\Y"], "win32"), "C:\\X;C:\\Y");
});
