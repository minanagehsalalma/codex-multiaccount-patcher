#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"

latest_ref="$(node ./scripts/detect-upstream-release.mjs --field tagName)"
latest_version="$(node ./scripts/detect-upstream-release.mjs --field normalizedVersion)"

if [[ "$latest_ref" != rust-v* && "$latest_ref" != v* ]]; then
  latest_ref="rust-v$latest_ref"
fi

echo "GitLab latest Codex ref: $latest_ref"
echo "GitLab latest Codex version: $latest_version"

rm -rf upstream

git clone --depth 1 --branch "$latest_ref" https://github.com/openai/codex.git upstream

node ./scripts/apply-maintained-patch.mjs --upstream-root ./upstream --json > ./dist-gitlab-patch-report.json

pushd upstream/codex-rs >/dev/null
export CODEX_TEST_CODEX_HOME_ROOT="$PWD/.codex-test-home"
mkdir -p "$CODEX_TEST_CODEX_HOME_ROOT"
cargo test -p codex-core --lib client::tests::current_client_setup_reloads_auth_from_disk_between_turns -- --exact
cargo test -p codex-core --test all suite::client_websockets::responses_websocket_reconnects_when_auth_snapshot_changes_between_turns -- --exact
cargo check -p codex-cli --release --locked
popd >/dev/null
