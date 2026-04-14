# Contributing

## Scope

This project patches upstream Codex auth hot-reload behavior and ships validated overlay binaries plus manifests.

Good contributions:

- upstream version compatibility fixes
- workflow hardening
- launcher/runtime correctness fixes
- regression tests
- Linux validation and install-flow verification

## Local Workflow

```bash
npm test
```

For upstream Codex patch validation:

```bash
npm run patch:check -- --upstream-root <path>
npm run patch:apply -- --upstream-root <path>
```

## Windows Maintainer Note

Large Codex builds can churn disk heavily on Windows. The cleanest local workflow here was:

- keep repo, `CARGO_HOME`, `CARGO_TARGET_DIR`, `TEMP`, and `TMP` on the same non-system drive
- avoid running multiple Cargo commands in parallel against the same workspace
- validate the focused regressions before rebuilding the CLI

## Release Discipline

Before publishing a release or changing the patch program:

1. keep the two focused regressions green
2. keep `codex-cli --version` smoke checks green on produced overlays
3. avoid machine-specific paths, usernames, or local install assumptions in docs or code
4. update [CHANGELOG.md](CHANGELOG.md)

## Pull Requests

- keep changes small and reviewable
- prefer new tests for new behavior
- do not reintroduce hardcoded local paths or host-specific shims
