import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function readJson(targetPath) {
  const raw = await fs.readFile(targetPath, "utf8");
  return JSON.parse(raw);
}

export async function writeJson(targetPath, value) {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function sha256File(targetPath) {
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

export async function copyFilePreserve(targetPath, destinationPath) {
  await ensureDir(path.dirname(destinationPath));
  await fs.copyFile(targetPath, destinationPath);
}

export function platformLabel(platform, arch) {
  return `${platform}-${arch}`;
}

export function codexExecutableName(platform) {
  return platform === "win32" ? "codex.exe" : "codex";
}

export function platformShimNames(platform) {
  if (platform === "win32") {
    return ["codex.cmd", "codex.ps1"];
  }
  return ["codex"];
}

export async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

export function normalizePathList(rawPathValue, platform = os.platform()) {
  const delimiter = platform === "win32" ? ";" : ":";
  return rawPathValue
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function renderPathList(entries, platform = os.platform()) {
  return entries.join(platform === "win32" ? ";" : ":");
}

export function pathStartsWithEntry(entries, expectedPath) {
  if (entries.length === 0) {
    return false;
  }
  return equalsPath(entries[0], expectedPath);
}

export function equalsPath(left, right) {
  if (process.platform === "win32") {
    return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
  }
  return path.normalize(left) === path.normalize(right);
}

export function uniquePaths(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = process.platform === "win32" ? path.normalize(entry).toLowerCase() : path.normalize(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }
  return result;
}

export function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
