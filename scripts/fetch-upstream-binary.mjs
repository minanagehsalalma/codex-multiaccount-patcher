#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const TARGETS = {
  "linux-x64": {
    packageVersionSuffix: "linux-x64",
    vendorTriple: "x86_64-unknown-linux-musl",
    executableName: "codex",
  },
  "win32-x64": {
    packageVersionSuffix: "win32-x64",
    vendorTriple: "x86_64-pc-windows-msvc",
    executableName: "codex.exe",
  },
};

function usage() {
  process.stdout.write(`fetch-upstream-binary

Required:
  --codex-version <version-or-tag>
  --platform <platform>
  --arch <arch>
  --output <path>
\n`);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${arg}`);
    }
    options[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
    i += 1;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  for (const key of ["codexVersion", "platform", "arch", "output"]) {
    if (!options[key]) {
      throw new Error(`missing required option --${key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`);
    }
  }

  const target = TARGETS[`${options.platform}-${options.arch}`];
  if (!target) {
    throw new Error(`unsupported target ${options.platform}-${options.arch}`);
  }

  const normalizedVersion = options.codexVersion.replace(/^rust-v/i, "").replace(/^v/i, "");
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-hotpatch-upstream-"));
  const tarballPath = await npmPack(`@openai/codex@${normalizedVersion}-${target.packageVersionSuffix}`, tempRoot);
  const extractDir = path.join(tempRoot, "extract");
  await fs.mkdir(extractDir, { recursive: true });
  await run("tar", ["-xf", tarballPath, "-C", extractDir]);

  const sourceBinaryPath = path.join(
    extractDir,
    "package",
    "vendor",
    target.vendorTriple,
    "codex",
    target.executableName,
  );
  await fs.access(sourceBinaryPath);
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.copyFile(sourceBinaryPath, options.output);
  process.stdout.write(`${options.output}\n`);
}

async function npmPack(spec, destinationDir) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = await run(npmCommand, ["pack", spec, "--silent", "--pack-destination", destinationDir]);
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tarballName = lines.at(-1);
  if (!tarballName) {
    throw new Error(`npm pack did not return a tarball name for ${spec}`);
  }
  return path.join(destinationDir, tarballName);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === "win32" && command.toLowerCase().endsWith(".cmd")
        ? spawn(
            process.env.ComSpec ?? "cmd.exe",
            ["/d", "/s", "/c", `${quoteCmdArg(command)} ${args.map(quoteCmdArg).join(" ")}`],
            {
              stdio: ["ignore", "pipe", "pipe"],
              shell: false,
              windowsHide: true,
            },
          )
        : spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
            windowsHide: true,
          });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`.trim()));
    });
  });
}

function quoteCmdArg(value) {
  if (/[\s"&|<>^]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
