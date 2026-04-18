import { normalizeVersionTag } from "./upstream-versions.js";
import { resolveCodexRef, sanitizeReleaseTagComponent } from "./upstream-source.js";

export function resolveExplicitReleaseTarget(value, { releaseTag = null } = {}) {
  const raw = `${value ?? ""}`.trim();
  if (!raw) {
    throw new Error("explicit upstream target is required");
  }

  const codexVersion = normalizeVersionTag(raw);
  const codexRef = resolveCodexRef(raw);
  const defaultReleaseComponent = sanitizeReleaseTagComponent(codexVersion);

  return {
    codexRef,
    codexVersion,
    releaseTag: releaseTag?.trim() ? releaseTag.trim() : `multiaccount-patcher-${defaultReleaseComponent}`,
    issueTitle: buildFailureIssueTitle(codexVersion),
  };
}

export function buildFailureIssueTitle(version) {
  return `Support upstream Codex ${normalizeVersionTag(version)}`;
}
