# codex-hotpatch

`codex-hotpatch` keeps a patched `codex` binary in front of the upstream install by owning a higher-precedence shim directory and a managed overlay cache.

It exists for one specific problem: upstream Codex does not reliably pick up auth/account changes between turns. This project patches that behavior, validates it against focused regressions, and ships release artifacts that users can install without rebuilding Codex locally.

## What You Get

- persistent `codex` shims on Windows and Linux
- managed overlay binaries selected by exact upstream hash
- launch-time refresh instead of fragile background watcher maintenance
- multi-version compatibility sweeps in GitHub Actions
- fail-closed behavior when no validated overlay exists for the installed upstream Codex build

## Status

- Windows x64 validated locally end to end
- Linux x64 supported in the release and compatibility pipeline
- latest fully validated upstream at the time of writing: [Codex 0.120.0 validation](latest-validation-0.120.0.md)

## Quickstart

Prerequisites:

- Node.js 20+
- a normal `@openai/codex` install already on the machine

Install the patcher from GitHub:

```bash
npm install -g github:minanagehsalalma/codex-hotpatch
```

Install the managed shims and pull the latest published manifest:

```bash
codex-hotpatch install
```

Check what the patcher sees:

```bash
codex-hotpatch status
```

After install, plain `codex` should route through the managed shim automatically.

## Command Surface

```text
codex-hotpatch install [--overlay-path <path>] [--manifest <file-or-url>] [--path <upstream-binary>] [--force]
codex-hotpatch status
codex-hotpatch repair
codex-hotpatch uninstall
codex-hotpatch launch -- [codex args...]
```

Normal users should only need `install`, `status`, `repair`, and `uninstall`.

## How It Works

At launch time the patcher:

1. discovers the current upstream Codex binary
2. hashes it
3. resolves the matching overlay from the active manifest
4. refreshes the managed overlay cache if needed
5. launches the patched binary through a patcher-owned shim

That means updates survive better than direct binary replacement. If upstream Codex changes, the next launch can select a new compatible overlay without mutating the vendor binary in place.

Architecture details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Maintenance Model

This repo no longer depends on hand-refreshing one large patch file for every upstream release.

The maintained patch is hybrid:

- scripted runtime rewrites in [src/lib/maintained-patch.js](src/lib/maintained-patch.js)
- a small fallback test patch in [patches/codex-hot-reload-tests.patch](patches/codex-hot-reload-tests.patch)
- two focused regressions that gate release artifacts

The critical regressions are:

- `current_client_setup_reloads_auth_from_disk_between_turns`
- `responses_websocket_reconnects_when_auth_snapshot_changes_between_turns`

## CI

There are two distinct GitHub Actions workflows:

- [publish-hotpatch.yml](.github/workflows/publish-hotpatch.yml)
  Builds and publishes validated overlay assets plus `manifest.json`
- [compatibility-sweep.yml](.github/workflows/compatibility-sweep.yml)
  Runs the maintained patch program across multiple upstream Codex versions without publishing anything

The compatibility sweep resolves stable upstream releases automatically from npm and can run in:

- `fast` mode: Linux only
- `full` mode: Linux and Windows

Local helper:

```bash
npm run versions:matrix -- --count 5 --min-version 0.118.0 --target-set fast
```

## Dev

Maintainer commands:

```bash
npm test
npm run patch:check -- --upstream-root <path>
npm run patch:apply -- --upstream-root <path>
npm run upstream:detect
npm run upstream:fetch -- --codex-version <version> --platform <platform> --arch <arch> --output <path>
```

Contribution and maintainer workflow notes are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Limitations

- Windows x64 is the only platform validated live so far
- Linux x64 is wired into CI but still needs a publish-install verification pass on a real Linux machine
- the patcher currently targets official global Codex installs first, with `--path` for custom layouts
- if no compatible overlay exists yet for a newly updated upstream Codex build, launch fails closed until CI publishes one

## Trust Files

- [LICENSE](LICENSE)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [CHANGELOG.md](CHANGELOG.md)
