import path from "node:path";
import { promises as fs } from "node:fs";

import { codexExecutableName, copyFilePreserve, ensureDir, pathExists, sha256File } from "./util.js";

export async function ensureManagedOverlay(context, dirs, record) {
  const managedOverlayPath = resolveManagedOverlayPath(context, dirs, record);
  const expectedSha256 = record.overlaySha256 ?? record.overlaySourceSha256 ?? null;

  if (await pathExists(managedOverlayPath)) {
    if (!expectedSha256) {
      return { managedOverlayPath, overlaySha256: await sha256File(managedOverlayPath) };
    }
    const existingSha256 = await sha256File(managedOverlayPath);
    if (existingSha256 === expectedSha256) {
      return { managedOverlayPath, overlaySha256: existingSha256 };
    }
  }

  await ensureDir(path.dirname(managedOverlayPath));

  if (record.overlaySourcePath) {
    if (!(await pathExists(record.overlaySourcePath))) {
      throw new Error(`overlay source binary not found: ${record.overlaySourcePath}`);
    }
    await copyFilePreserve(record.overlaySourcePath, managedOverlayPath);
  } else if (record.overlayUrl) {
    await downloadOverlay(record.overlayUrl, managedOverlayPath);
  } else {
    throw new Error(`record ${record.id} does not include a usable overlay source`);
  }

  const actualSha256 = await sha256File(managedOverlayPath);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    await fs.unlink(managedOverlayPath).catch(() => {});
    throw new Error(
      `overlay hash mismatch for ${record.id}. Expected ${expectedSha256}, got ${actualSha256}.`,
    );
  }

  return { managedOverlayPath, overlaySha256: actualSha256 };
}

export function resolveManagedOverlayPath(context, dirs, record) {
  if (record.managedOverlayPath) {
    return record.managedOverlayPath;
  }
  const overlayHash = record.overlaySha256 ?? record.overlaySourceSha256 ?? "unhashed";
  const overlayName = resolveOverlayFilename(context, record);
  return path.join(dirs.overlaysDir, overlayHash, overlayName);
}

function resolveOverlayFilename(context, record) {
  if (record.overlayFilename) {
    return record.overlayFilename;
  }
  const source = record.overlaySourcePath ?? record.overlayUrl ?? null;
  if (!source) {
    return codexExecutableName(context.platform);
  }
  try {
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source);
      const fromUrl = path.posix.basename(url.pathname);
      return fromUrl || codexExecutableName(context.platform);
    }
  } catch {
    // ignore and fall back to path parsing
  }
  return path.basename(source);
}

async function downloadOverlay(url, destinationPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download overlay: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.writeFile(destinationPath, buffer);
}
