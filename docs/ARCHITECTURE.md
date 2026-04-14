# Architecture

## Runtime Model

`codex-hotpatch` is intentionally simple at runtime:

1. patcher-owned shims live in `~/.codex-hotpatch/bin`
2. those shims forward into `codex-hotpatch launch -- ...`
3. launch discovers the current upstream Codex vendor binary
4. the upstream binary hash is matched against the active manifest
5. the matching overlay is materialized into `~/.codex-hotpatch/overlays/<hash>/`
6. the overlay binary is executed with the upstream helper `path/` entries preserved

The patcher never needs to replace the live upstream vendor binary in place.

## State

Managed state lives under `~/.codex-hotpatch/`:

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
