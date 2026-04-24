# Changelog

## Unreleased

- refreshed the bundled Windows `codex-auth` snapshot with portable single-file export/import support, additive import behavior, and subscription-end visibility in `auth list`
- changed Windows auth resolution to prefer the vendored snapshot before any global install so the bundled features are actually used
- documented that the maintained patch intentionally relocates temp-root test `CODEX_HOME` harnesses on hosts where release-mode helper setup rejects temporary roots
- added `pin` helpers to `codex-multiaccount` and the bundled `codex-auth` shim so manual account selection can disable auto-switch first and stay pinned
- documented the difference between `switch` and `pin` for more predictable manual account control
- added a maintained patch program with scripted rewrites plus a fallback test patch
- added a multi-version GitHub Actions compatibility sweep
- added default published-manifest install behavior
- removed hardcoded local overlay discovery paths from install logic
- documented architecture, contribution flow, and security expectations
