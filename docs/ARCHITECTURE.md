# Architecture

## Runtime Model

`codex-multiaccount-patcher` is intentionally simple at runtime:

1. patcher-owned shims live in `~/.codex-multiaccount/bin`
2. those shims forward into `codex-multiaccount launch -- ...`
3. launch discovers the current upstream Codex vendor binary
4. the upstream binary hash is matched against the active manifest
5. the matching overlay is materialized into `~/.codex-multiaccount/overlays/<hash>/`
6. the overlay binary is executed with the upstream helper `path/` entries preserved

The patcher never needs to replace the live upstream vendor binary in place.

## State

Managed state lives under `~/.codex-multiaccount/`:

- `bin/` managed shims
- `manifests/active.json` current manifest cache
- `overlays/` cached patched binaries
- `state.json` current install state

## Why A Shim Instead Of In-Place Mutation

This avoids the worst Windows update and file-locking problems:

- no need to overwrite a running `.exe`
- no need for scheduled task helpers or background daemons
- no dependence on npm preserving edited launchers across updates

The same approach is cleaner on Linux too: replace the selected overlay, not the upstream vendor binary.

## Patch Maintenance Model

The fix is maintained as a patch program:

- runtime rewrites in `src/lib/maintained-patch.js`
- fallback test patch in `patches/codex-hot-reload-tests.patch`

That is intentionally more resilient than carrying one giant line-based patch forward forever.

The maintained patch also carries a small host-compatibility responsibility for upstream test harnesses. Some upstream release-mode harnesses create `CODEX_HOME` under the active temporary directory, but helper setup can reject that location on certain machines. When upstream still has that layout, the maintained patch rewrites the harness to create test `CODEX_HOME` roots outside the temp root instead of leaving local validation to fail for machine-specific reasons. The focused tests in `test/maintained-patch.test.js` cover that behavior so it stays intentional and reviewable.

## Release Model

The publish workflow:

1. detects the upstream Codex version/tag
2. checks out the matching source ref
3. applies the maintained patch program
4. runs the two focused regressions
5. builds overlay binaries for each target
6. generates manifest records keyed by exact upstream hash
7. publishes overlays plus `manifest.json`

Users install the patcher once. After that, the patcher follows published manifest records and overlay assets.

## Compatibility Sweep

The compatibility sweep is separate from release publishing.

It exists to answer:

- does the patch program still adapt across recent upstream versions?
- do the focused regressions still pass across normal upstream drift?

That workflow exercises multiple upstream Codex versions in the cloud without making local users rebuild them one by one.
