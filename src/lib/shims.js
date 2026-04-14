import path from "node:path";
import { promises as fs } from "node:fs";

import { ensureDir, pathExists } from "./util.js";

export async function writeManagedShims(context, managedBinDir) {
  await ensureDir(managedBinDir);
  const cliPath = path.join(context.projectRoot, "src", "cli.js");
  const nodePath = context.execPath;

  if (context.platform === "win32") {
    await fs.writeFile(
      path.join(managedBinDir, "codex.cmd"),
      renderCmdShim(nodePath, cliPath, ["launch", "--"]),
      "utf8",
    );
    await fs.writeFile(
      path.join(managedBinDir, "codex.ps1"),
      renderPs1Shim(nodePath, cliPath, ["launch", "--"]),
      "utf8",
    );
    await fs.writeFile(
      path.join(managedBinDir, "codex-hotpatch.cmd"),
      renderCmdShim(nodePath, cliPath, []),
      "utf8",
    );
    await fs.writeFile(
      path.join(managedBinDir, "codex-hotpatch.ps1"),
      renderPs1Shim(nodePath, cliPath, []),
      "utf8",
    );
    return;
  }

  const codexShimPath = path.join(managedBinDir, "codex");
  const patcherShimPath = path.join(managedBinDir, "codex-hotpatch");
  await fs.writeFile(codexShimPath, renderShellShim(nodePath, cliPath, ["launch", "--"]), "utf8");
  await fs.writeFile(patcherShimPath, renderShellShim(nodePath, cliPath, []), "utf8");
  await fs.chmod(codexShimPath, 0o755);
  await fs.chmod(patcherShimPath, 0o755);
}

export async function removeManagedShims(context, managedBinDir) {
  const names =
    context.platform === "win32"
      ? ["codex.cmd", "codex.ps1", "codex-hotpatch.cmd", "codex-hotpatch.ps1"]
      : ["codex", "codex-hotpatch"];
  for (const name of names) {
    const target = path.join(managedBinDir, name);
    if (await pathExists(target)) {
      await fs.unlink(target);
    }
  }
}

function renderCmdShim(nodePath, cliPath, prefixArgs) {
  const renderedPrefix = prefixArgs.map((arg) => `"${arg}"`).join(" ");
  const joined = renderedPrefix.length > 0 ? `${renderedPrefix} ` : "";
  return `@ECHO off\r\nSETLOCAL\r\n"${nodePath}" "${cliPath}" ${joined}%*\r\nEXIT /b %ERRORLEVEL%\r\n`;
}

function renderPs1Shim(nodePath, cliPath, prefixArgs) {
  const renderedPrefix = prefixArgs.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(", ");
  const prefixArray = renderedPrefix.length > 0 ? `@(${renderedPrefix})` : "@()";
  return `#!/usr/bin/env pwsh\n$node = "${escapePowerShell(nodePath)}"\n$cli = "${escapePowerShell(cliPath)}"\n$prefix = ${prefixArray}\n$allArgs = $prefix + $args\nif ($MyInvocation.ExpectingInput) {\n  $input | & $node $cli @allArgs\n} else {\n  & $node $cli @allArgs\n}\nexit $LASTEXITCODE\n`;
}

function renderShellShim(nodePath, cliPath, prefixArgs) {
  const renderedPrefix = prefixArgs.map((arg) => `"${arg}"`).join(" ");
  const joined = renderedPrefix.length > 0 ? `${renderedPrefix} ` : "";
  return `#!/usr/bin/env sh\nexec "${nodePath}" "${cliPath}" ${joined}"$@"\n`;
}

function escapePowerShell(value) {
  return value.replace(/`/g, "``").replace(/"/g, "`\"");
}
