import path from "node:path";
import { promises as fs } from "node:fs";

import { MANIFEST_SCHEMA_VERSION } from "./constants.js";
import { pathExists, readJson, writeJson } from "./util.js";

export async function loadManifest(manifestPathOrUrl) {
  if (/^https?:\/\//i.test(manifestPathOrUrl)) {
    const response = await fetch(manifestPathOrUrl);
    if (!response.ok) {
      throw new Error(`failed to fetch manifest: ${response.status} ${response.statusText}`);
    }
    const manifest = await response.json();
    validateManifest(manifest);
    return manifest;
  }
  if (!(await pathExists(manifestPathOrUrl))) {
    throw new Error(`manifest not found: ${manifestPathOrUrl}`);
  }
  const manifest = await readJson(manifestPathOrUrl);
  const manifestDir = path.dirname(path.resolve(manifestPathOrUrl));
  for (const record of manifest.records ?? []) {
    if (record.overlaySourcePath && !path.isAbsolute(record.overlaySourcePath)) {
      record.overlaySourcePath = path.resolve(manifestDir, record.overlaySourcePath);
    }
    if (record.managedOverlayPath && !path.isAbsolute(record.managedOverlayPath)) {
      record.managedOverlayPath = path.resolve(manifestDir, record.managedOverlayPath);
    }
  }
  validateManifest(manifest);
  return manifest;
}

export function createLocalManifestRecord({
  codexVersion,
  platform,
  arch,
  upstreamBinaryPath,
  upstreamSha256,
  overlaySourcePath,
  overlaySourceSha256,
  managedOverlayPath,
}) {
  return {
    id: `${codexVersion}-${platform}-${arch}-${upstreamSha256.slice(0, 12)}`,
    codexVersion,
    platform,
    arch,
    upstreamBinaryPath,
    upstreamSha256,
    overlaySourcePath,
    overlaySourceSha256,
    overlaySha256: overlaySourceSha256,
    overlayFilename: overlaySourcePath ? undefined : null,
    managedOverlayPath,
  };
}

export async function saveManifest(manifestPath, records) {
  await writeJson(manifestPath, {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    records,
  });
}

export function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION || !Array.isArray(manifest.records)) {
    throw new Error("invalid manifest");
  }
  for (const record of manifest.records) {
    if (!record?.id || !record?.platform || !record?.arch || !record?.upstreamSha256) {
      throw new Error("invalid manifest record");
    }
    if (!record.overlaySourcePath && !record.managedOverlayPath && !record.overlayUrl) {
      throw new Error(`manifest record ${record.id} is missing an overlay source`);
    }
  }
}

export function findManifestRecord(manifest, upstreamSha256, platform, arch) {
  return (
    manifest.records.find(
      (record) =>
        record.upstreamSha256 === upstreamSha256 &&
        record.platform === platform &&
        record.arch === arch,
    ) ?? null
  );
}

export async function deleteManifest(manifestPath) {
  if (await pathExists(manifestPath)) {
    await fs.unlink(manifestPath);
  }
}

export function withManagedOverlayPath(record, managedOverlayPath, overlaySha256 = null) {
  return {
    ...record,
    managedOverlayPath,
    overlaySha256: overlaySha256 ?? record.overlaySha256 ?? record.overlaySourceSha256 ?? null,
  };
}
