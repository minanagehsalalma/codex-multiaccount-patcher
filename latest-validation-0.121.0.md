# Codex 0.121.0 Validation

Date: 2026-04-16
Upstream ref: `rust-v0.121.0`
Normalized version: `0.121.0`
Patch release: `multiaccount-patcher-0.121.0`

## Result

The maintained multiaccount patch pipeline validated and published support for Codex `0.121.0`.

## Checks completed

1. Ran the maintained patch program against upstream `rust-v0.121.0`.
2. Passed the focused runtime auth-reload regression in `compatibility-sweep`.
3. Passed the focused websocket reconnect regression in `compatibility-sweep`.
4. Passed `cargo check -p codex-cli --release --locked` in `compatibility-sweep`.
5. Built and published the release overlays and merged manifest in `publish-hotpatch`.
6. Published release assets under `multiaccount-patcher-0.121.0`.

## Primary workflow runs

- Compatibility: `24521681815`
- Publish: `24517724519`

## Notes

- The unattended maintenance path is now GitHub-only.
- The GitLab fallback experiment was removed after repeated failures on a stale mirrored commit and no sustained green signal.
