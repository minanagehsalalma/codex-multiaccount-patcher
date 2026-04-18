import test from "node:test";
import assert from "node:assert/strict";

import { selectLatestGitHubRelease } from "../src/lib/upstream-release.js";
import {
  isSemverLikeTag,
  resolveCodexRef,
  resolveGitHubReleaseAssetName,
  sanitizeReleaseTagComponent,
} from "../src/lib/upstream-source.js";

test("isSemverLikeTag only accepts semver-shaped versions", () => {
  assert.equal(isSemverLikeTag("0.121.0"), true);
  assert.equal(isSemverLikeTag("rust-v0.121.0-beta.1"), true);
  assert.equal(isSemverLikeTag("remote-compact-timeout-recovery-ea2504064"), false);
});

test("resolveCodexRef prefixes semver refs but preserves fork tags", () => {
  assert.equal(resolveCodexRef("0.121.0"), "rust-v0.121.0");
  assert.equal(resolveCodexRef("v0.121.0"), "v0.121.0");
  assert.equal(resolveCodexRef("remote-compact-timeout-recovery-ea2504064"), "remote-compact-timeout-recovery-ea2504064");
});

test("sanitizeReleaseTagComponent strips invalid tag characters", () => {
  assert.equal(sanitizeReleaseTagComponent("fix/remote compact timeout"), "fix-remote-compact-timeout");
});

test("resolveGitHubReleaseAssetName matches supported targets", () => {
  assert.equal(resolveGitHubReleaseAssetName("linux", "x64"), "codex-linux-x64");
  assert.equal(resolveGitHubReleaseAssetName("win32", "x64"), "codex-win32-x64.exe");
});

test("selectLatestGitHubRelease skips prereleases unless requested", () => {
  const releases = [
    { tag_name: "preview-1", prerelease: true, draft: false },
    { tag_name: "rust-v0.121.0", prerelease: false, draft: false },
  ];
  assert.equal(selectLatestGitHubRelease(releases, { includePrereleases: false }).tag_name, "rust-v0.121.0");
  assert.equal(selectLatestGitHubRelease(releases, { includePrereleases: true }).tag_name, "preview-1");
});
