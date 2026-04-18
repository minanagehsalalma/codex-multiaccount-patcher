import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFailureIssueTitle,
  resolveExplicitReleaseTarget,
} from "../src/lib/release-target.js";

test("resolveExplicitReleaseTarget normalizes bare versions", () => {
  assert.deepEqual(resolveExplicitReleaseTarget("0.121.0"), {
    codexRef: "rust-v0.121.0",
    codexVersion: "0.121.0",
    releaseTag: "multiaccount-patcher-0.121.0",
    issueTitle: "Support upstream Codex 0.121.0",
  });
});

test("resolveExplicitReleaseTarget preserves tagged refs and custom release tags", () => {
  assert.deepEqual(resolveExplicitReleaseTarget("v0.121.0", { releaseTag: "custom-tag" }), {
    codexRef: "v0.121.0",
    codexVersion: "0.121.0",
    releaseTag: "custom-tag",
    issueTitle: "Support upstream Codex 0.121.0",
  });
});

test("buildFailureIssueTitle uses normalized versions", () => {
  assert.equal(buildFailureIssueTitle("rust-v0.121.0"), "Support upstream Codex 0.121.0");
});

test("resolveExplicitReleaseTarget preserves non-semver fork tags", () => {
  assert.deepEqual(resolveExplicitReleaseTarget("remote-compact-timeout-recovery-ea2504064"), {
    codexRef: "remote-compact-timeout-recovery-ea2504064",
    codexVersion: "remote-compact-timeout-recovery-ea2504064",
    releaseTag: "multiaccount-patcher-remote-compact-timeout-recovery-ea2504064",
    issueTitle: "Support upstream Codex remote-compact-timeout-recovery-ea2504064",
  });
});
