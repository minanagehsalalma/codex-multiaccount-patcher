#!/usr/bin/env node
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

function usage() {
  process.stdout.write(`generate-manifest

Required:
  --codex-version <version>
  --platform <platform>
  --arch <arch>
  --upstream-binary <path>
  --overlay-binary <path>
  --output <path>

Optional:
  --overlay-url <https-url>
  --overlay-filename <name>
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

async function sha256File(targetPath) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(targetPath, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function ensureFile(targetPath, label) {
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(`${label} not found: ${targetPath}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  for (const key of ["codexVersion", "platform", "arch", "upstreamBinary", "overlayBinary", "output"]) {
    if (!options[key]) {
      throw new Error(`missing required option --${key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`);
    }
  }

  await ensureFile(options.upstreamBinary, "upstream binary");
  await ensureFile(options.overlayBinary, "overlay binary");

  const upstreamSha256 = await sha256File(options.upstreamBinary);
  const overlaySha256 = await sha256File(options.overlayBinary);
  const record = {
    id: `${options.codexVersion}-${options.platform}-${options.arch}-${upstreamSha256.slice(0, 12)}`,
    codexVersion: options.codexVersion,
    platform: options.platform,
    arch: options.arch,
    upstreamSha256,
    overlaySha256,
    overlayFilename: options.overlayFilename ?? path.basename(options.overlayBinary),
    overlayUrl: options.overlayUrl ?? null,
    overlaySourcePath: options.overlayUrl ? null : options.overlayBinary,
  };

  const manifest = {
    schemaVersion: 1,
    records: [record],
  };

  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${options.output}\n`);
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
