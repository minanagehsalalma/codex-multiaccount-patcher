import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { inspectAuthCli, parseAutoSwitchEnabled, runAuthCli } from "../src/lib/auth-cli.js";

test("inspectAuthCli prefers vendored codex-auth snapshot", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-multiaccount-auth-"));
  const vendoredDir = path.join(tempRoot, "vendor", "codex-auth-working-snapshot", "bin");
  await fs.mkdir(vendoredDir, { recursive: true });
  const captureFile = path.join(tempRoot, "capture.txt");
  const entrypoint = path.join(vendoredDir, "codex-auth.js");
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
    platform: "win32",
    arch: "x64",
    projectRoot: tempRoot,
    execPath: process.execPath,
    preferBundledAuth: true,
  };

  const inspection = await inspectAuthCli(context);
  assert.equal(inspection.source, "vendored-working-snapshot");
  assert.equal(inspection.entrypoint, entrypoint);

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

test("inspectAuthCli prefers vendored snapshot over global install on Windows", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-multiaccount-auth-order-"));
  const vendoredDir = path.join(tempRoot, "vendor", "codex-auth-working-snapshot", "bin");
  await fs.mkdir(vendoredDir, { recursive: true });
  const vendoredEntrypoint = path.join(vendoredDir, "codex-auth.js");
  await fs.writeFile(vendoredEntrypoint, "module.exports = {};\n", "utf8");

  const fakeAppData = path.join(tempRoot, "appdata");
  const globalDir = path.join(fakeAppData, "npm", "node_modules", "@loongphy", "codex-auth", "bin");
  await fs.mkdir(globalDir, { recursive: true });
  const globalEntrypoint = path.join(globalDir, "codex-auth.js");
  await fs.writeFile(globalEntrypoint, "module.exports = {};\n", "utf8");

  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = fakeAppData;
  try {
    const context = {
      cwd: tempRoot,
      homeDir: tempRoot,
      platform: "win32",
      arch: "x64",
      projectRoot: tempRoot,
      execPath: process.execPath,
    };

    const inspection = await inspectAuthCli(context);
    assert.equal(inspection.source, "vendored-working-snapshot");
    assert.equal(inspection.entrypoint, vendoredEntrypoint);
    assert.notEqual(inspection.entrypoint, globalEntrypoint);
  } finally {
    if (previousAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previousAppData;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("parseAutoSwitchEnabled tolerates ANSI and mixed case", () => {
  assert.equal(parseAutoSwitchEnabled("\u001b[32mauto-switch: ON\u001b[0m\n"), true);
  assert.equal(parseAutoSwitchEnabled("auto-switch: off\n"), false);
  assert.equal(parseAutoSwitchEnabled("status: unknown\n"), null);
});
