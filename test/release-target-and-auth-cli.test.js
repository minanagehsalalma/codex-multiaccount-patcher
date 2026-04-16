import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runAuthCli } from "../src/lib/auth-cli.js";

test("runAuthCli prefers bundled codex-auth entrypoint", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-multiaccount-auth-"));
  const bundledDir = path.join(tempRoot, "node_modules", "@loongphy", "codex-auth", "bin");
  await fs.mkdir(bundledDir, { recursive: true });
  const captureFile = path.join(tempRoot, "capture.txt");
  const entrypoint = path.join(bundledDir, "codex-auth.js");
  await fs.writeFile(
    entrypoint,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(captureFile)}, JSON.stringify(process.argv.slice(2)));`,
    ].join("\n"),
    "utf8",
  );

  const context = {
    cwd: tempRoot,
    homeDir: tempRoot,
    platform: process.platform,
    arch: process.arch,
    projectRoot: tempRoot,
    execPath: process.execPath,
    preferBundledAuth: true,
  };

  const previousExit = process.exit;
  try {
    process.exit = ((code) => {
      throw new Error(`EXIT:${code ?? 0}`);
    });
    await assert.rejects(() => runAuthCli(context, ["status"]), /EXIT:0/);
  } finally {
    process.exit = previousExit;
  }

  const captured = JSON.parse(await fs.readFile(captureFile, "utf8"));
  assert.deepEqual(captured, ["status"]);
  await fs.rm(tempRoot, { recursive: true, force: true });
});
