import test from "node:test";
import assert from "node:assert/strict";

import { removeManagedProfileBlock, upsertManagedProfileBlock } from "../src/lib/path-env.js";

test("upsertManagedProfileBlock adds a single managed export block", () => {
  const once = upsertManagedProfileBlock("export PATH=\"$HOME/bin:$PATH\"\n", "/home/test/.codex-hotpatch/bin");
  const twice = upsertManagedProfileBlock(once, "/home/test/.codex-hotpatch/bin");

  assert.match(once, /# >>> codex-hotpatch >>>/);
  assert.equal(once, twice);
});

test("removeManagedProfileBlock strips the managed block cleanly", () => {
  const input = [
    "export PATH=\"$HOME/bin:$PATH\"",
    "",
    "# >>> codex-hotpatch >>>",
    "export PATH=\"/home/test/.codex-hotpatch/bin:$PATH\"",
    "# <<< codex-hotpatch <<<",
    "",
    "alias ll='ls -la'",
    "",
  ].join("\n");

  assert.equal(removeManagedProfileBlock(input), "export PATH=\"$HOME/bin:$PATH\"\n\nalias ll='ls -la'\n");
});
