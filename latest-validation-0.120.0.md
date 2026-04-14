# Codex 0.120.0 Validation

Date: 2026-04-14
Upstream ref: `rust-v0.120.0`
Normalized version: `0.120.0`

## Result

The hot-reload patch was ported to the latest upstream Codex source and validated successfully.
The repo now carries that logic through the maintained patch program:

- runtime rewrites in [maintained-patch.js](src/lib/maintained-patch.js)
- fallback test patch in [codex-hot-reload-tests.patch](patches/codex-hot-reload-tests.patch)

## Checks completed

1. Cloned upstream `rust-v0.120.0` into an isolated same-drive workspace with `CARGO_HOME`, `CARGO_TARGET_DIR`, `TEMP`, and `TMP` on the same volume.
2. Applied the maintained source changes to:
   - `codex-rs/core/src/client.rs`
   - `codex-rs/core/src/client_tests.rs`
   - `codex-rs/core/tests/common/responses.rs`
   - `codex-rs/core/tests/suite/client_websockets.rs`
3. Ran the focused unit regression:
   - `cargo test -p codex-core --lib --release client::tests::current_client_setup_reloads_auth_from_disk_between_turns -- --exact`
   - Result: passed
4. Ran the focused websocket regression:
   - `cargo test -p codex-core --test all --release suite::client_websockets::responses_websocket_reconnects_when_auth_snapshot_changes_between_turns -- --exact`
   - Result: passed
5. Built the latest CLI:
   - `cargo build -p codex-cli --release --locked`
   - Result: passed
6. Smoke-checked the built binary:
   - `target/release/codex.exe --version`
   - Result: `codex-cli 0.120.0`
7. Applied the maintained patch program to a fresh clean `rust-v0.120.0` clone.
8. Re-ran the two focused regressions on the rewrite-generated tree.
9. Rebuilt `codex-cli` from the rewrite-generated tree and smoke-checked `--version`.

## Built artifact

- Binary: `target/release/codex.exe`
- SHA-256: `B5108996420D0CE72B47127D26ED91DEB5D2486DBB2A367DA85001AE7C104B0D`

## Notes

- One drift fix was required for the latest upstream: `codex-core` test code now needs `codex_login::CodexAuth` imported directly instead of using `crate::CodexAuth`.
- Validation was run sequentially to avoid Cargo cache locking and Windows disk churn.
