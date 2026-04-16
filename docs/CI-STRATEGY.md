# CI Strategy

This project has one expensive step: compiling and testing patched Codex on real Windows and Linux runners. The goal is not to chase every CI provider. The goal is to keep one primary lane fast, predictable, and easy to trust.

## Recommendation

Use GitHub Actions as the main pipeline.

Why:
- the source of truth is already a GitHub repo
- Windows runners are first-class and easy to combine with Linux in one matrix
- the release path already depends on GitHub Releases and workflow permissions
- public-repo ergonomics are materially better than mirroring into another platform just to run the same Rust compile

## What Changed Here

The workflows now lean on Rust-specific caching and release validation:
- `Swatinem/rust-cache@v2` restores Cargo dependencies and dependency-heavy target artifacts
- release publishing validates every manifest URL before a release is created
- the compatibility sweep stays separate from publishing so version coverage does not clutter releases

This is the practical answer to long Rust phases: make repeated builds cheaper and make bad publishes impossible.

## Why Not Default To Another Provider

### GitLab CI

GitLab CI is viable, but this repo is GitHub-native and the release artifacts already publish back to GitHub. That means mirroring, runner setup, or extra operational glue just to replace a workflow engine that already has the right OS support.

### Bottom line

If the pain is compile time, better caching on GitHub Actions is the first fix. If the pain becomes queue time or GitHub-hosted runner limits, the next fallback should be introduced intentionally and kept narrower than the primary release lane.

## Practical Tuning Order

1. Keep the default compatibility lane on `fast` mode unless Windows coverage is actually needed.
2. Reuse Rust caches aggressively on both compatibility and publish jobs.
3. Fail before publish when manifest metadata is wrong.
4. Only add a second CI provider if GitHub-hosted runner time, not compile work, becomes the real limit.

## GitLab Fallback

A Linux-only GitLab fallback lane now lives in [`.gitlab-ci.yml`](../.gitlab-ci.yml). It is intentionally scoped:
- validate the maintained patch against the latest upstream Codex on Linux
- run the two focused regressions
- build the patched CLI once

It is not the authoritative release pipeline. GitHub Actions still owns Windows validation, release manifest generation, and publishing.
