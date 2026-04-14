import path from "node:path";
import { promises as fs } from "node:fs";
import process from "node:process";

import {
  normalizePathList,
  pathStartsWithEntry,
  renderPathList,
  runCommand,
  uniquePaths,
} from "./util.js";

const PROFILE_BLOCK_START = "# >>> codex-hotpatch >>>";
const PROFILE_BLOCK_END = "# <<< codex-hotpatch <<<";

export async function ensureManagedBinOnUserPath(context, managedBinDir) {
  if (context.platform === "win32") {
    const current = await getWindowsUserPath();
    let entries = normalizePathList(current, "win32");
    entries = [managedBinDir, ...entries.filter((entry) => entry.toLowerCase() !== managedBinDir.toLowerCase())];
    const nextValue = renderPathList(uniquePaths(entries), "win32");
    await setWindowsUserPath(nextValue);
    process.env.Path = nextValue;
    return { changed: !pathStartsWithEntry(normalizePathList(current, "win32"), managedBinDir), value: nextValue };
  }

  const profilePath = path.join(context.homeDir, ".profile");
  const current = await readTextFile(profilePath);
  const nextValue = upsertManagedProfileBlock(current, managedBinDir);
  if (nextValue !== current) {
    await fs.writeFile(profilePath, nextValue, "utf8");
  }
  const entries = normalizePathList(process.env.PATH ?? "", context.platform);
  process.env.PATH = renderPathList(uniquePaths([managedBinDir, ...entries]), context.platform);
  return { changed: nextValue !== current, value: nextValue };
}

export async function removeManagedBinFromUserPath(context, managedBinDir) {
  if (context.platform === "win32") {
    const current = await getWindowsUserPath();
    const entries = normalizePathList(current, "win32").filter((entry) => entry.toLowerCase() !== managedBinDir.toLowerCase());
    const nextValue = renderPathList(uniquePaths(entries), "win32");
    await setWindowsUserPath(nextValue);
    process.env.Path = nextValue;
    return { changed: current !== nextValue, value: nextValue };
  }

  const profilePath = path.join(context.homeDir, ".profile");
  const current = await readTextFile(profilePath);
  const nextValue = removeManagedProfileBlock(current);
  if (nextValue !== current) {
    await fs.writeFile(profilePath, nextValue, "utf8");
  }
  const entries = normalizePathList(process.env.PATH ?? "", context.platform).filter((entry) => entry !== managedBinDir);
  process.env.PATH = renderPathList(uniquePaths(entries), context.platform);
  return { changed: nextValue !== current, value: nextValue };
}

async function getWindowsUserPath() {
  const result = await runCommand("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    "[Environment]::GetEnvironmentVariable('Path','User')",
  ]);
  if (result.code !== 0) {
    throw new Error(`failed to read user PATH: ${result.stderr || result.stdout}`.trim());
  }
  return result.stdout.trim();
}

async function setWindowsUserPath(nextValue) {
  const escaped = nextValue.replace(/'/g, "''");
  const result = await runCommand("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    `[Environment]::SetEnvironmentVariable('Path','${escaped}','User')`,
  ]);
  if (result.code !== 0) {
    throw new Error(`failed to update user PATH: ${result.stderr || result.stdout}`.trim());
  }
}

async function readTextFile(targetPath) {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export function upsertManagedProfileBlock(current, managedBinDir) {
  const cleaned = removeManagedProfileBlock(current).replace(/\s+$/, "");
  const block = [
    PROFILE_BLOCK_START,
    `export PATH="${escapePosixPath(managedBinDir)}:$PATH"`,
    PROFILE_BLOCK_END,
  ].join("\n");
  return cleaned.length > 0 ? `${cleaned}\n\n${block}\n` : `${block}\n`;
}

export function removeManagedProfileBlock(current) {
  const escapedStart = PROFILE_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = PROFILE_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, "g");
  return current.replace(pattern, "").replace(/\n{3,}/g, "\n\n");
}

function escapePosixPath(value) {
  return value.replace(/(["\\$`])/g, "\\$1");
}
