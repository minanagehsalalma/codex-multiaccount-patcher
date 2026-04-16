# CI Strategy

This project has one expensive step: compiling and testing patched Codex on real Windows and Linux runners. The goal is not to chase every CI provider. The goal is to keep one primary lane fast, predictable, and easy to trust.

## Recommendation

Use GitHub Actions as the only maintained pipeline.

Why:
- the source of truth is already a GitHub repo
- Windows runners are first-class and easy to combine with Linux in one matrix
- the release path already depends on GitHub Releases and workflow permissions
- public-repo ergonomics are materially better than mirroring into another platform just to run the same Rust compile
- the unattended maintenance loop now depends on reusable GitHub workflows, releases, and issue automation in one place

## What Changed Here

The workflows now lean on Rust-specific caching, unattended orchestration, and release validation:
- `Swatinem/rust-cache@v2` restores Cargo dependencies and dependency-heavy target artifacts
- release publishing validates every manifest URL before a release is created
- the compatibility sweep stays separate from publishing so version coverage does not clutter releases
- `auto-maintain-upstream` detects the latest upstream release, skips work if the matching patch release already exists, and opens a tracked failure issue only when the deterministic path breaks

This is the practical answer to long Rust phases: make repeated builds cheaper and make bad publishes impossible.

## Why Not Default To Another Provider

The GitLab fallback experiment was removed after repeated failures on a stale mirrored commit. Even as a narrow Linux-only lane, it was adding mirror drift and provider-specific failure modes without increasing confidence in published patch releases.

Bottom line:

If the pain is compile time, better caching on GitHub Actions is the first fix. If the pain becomes queue time or GitHub-hosted runner limits, another provider should only be added if it can run from the same source of truth and prove stable over multiple green runs.

## Practical Tuning Order

1. Keep the default compatibility lane on `fast` mode unless Windows coverage is actually needed.
2. Reuse Rust caches aggressively on both compatibility and publish jobs.
3. Fail before publish when manifest metadata is wrong.
4. Only add a second CI provider if GitHub-hosted runner time, not compile work, becomes the real limit.
