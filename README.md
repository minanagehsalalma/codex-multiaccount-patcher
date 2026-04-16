<div align="center">
  <p>
    <img width="240" alt="Codex multiaccount patcher mascot" src="https://github.com/user-attachments/assets/8ee532dc-9cf2-4e30-ae1c-02d4261c28a8" />
  </p>
  <h1>codex-multiaccount-patcher</h1>
  <p><strong>Patch Codex once, keep account switching seamless across turns.</strong></p>
  <p>
    <a href="https://github.com/minanagehsalalma/codex-multiaccount-patcher/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/minanagehsalalma/codex-multiaccount-patcher?display_name=tag&label=release"></a>
    <a href="https://github.com/minanagehsalalma/codex-multiaccount-patcher/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-4b5563"></a>
    <a href="https://nodejs.org/"><img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-0f766e"></a>
    <a href="https://github.com/minanagehsalalma/codex-multiaccount-patcher"><img alt="Platforms" src="https://img.shields.io/badge/platforms-windows%20%7C%20linux-1d4ed8"></a>
    <a href="https://github.com/minanagehsalalma/codex-multiaccount-patcher/actions/workflows/publish-hotpatch.yml?query=branch%3Amain"><img alt="Publish Hotpatch" src="https://github.com/minanagehsalalma/codex-multiaccount-patcher/actions/workflows/publish-hotpatch.yml/badge.svg?branch=main"></a>
    <a href="https://github.com/minanagehsalalma/codex-multiaccount-patcher/actions/workflows/compatibility-sweep.yml?query=branch%3Amain"><img alt="Compatibility Sweep" src="https://github.com/minanagehsalalma/codex-multiaccount-patcher/actions/workflows/compatibility-sweep.yml/badge.svg?branch=main"></a>
  </p>
</div>

`codex-multiaccount-patcher` is now a single toolkit: it keeps a patched `codex` binary in front of the upstream install and bundles the `codex-auth` account manager behind the same install. The point is still narrow and practical: switch accounts cleanly, auto-switch when thresholds are hit, and let Codex pick up auth changes between turns without making you rebuild locally or restart the CLI.

## Why This Exists

OpenAI Codex still behaves like a single-account CLI in practice. If you rotate between personal, work, or quota-spillover accounts, the official flow is still mostly `login`, overwrite auth state, and restart the session. This toolkit exists to close that gap with the smallest surface area possible:

- keep upstream Codex installed normally
- keep account state in the same `~/.codex` home Codex already uses
- put a managed shim in front of `codex`
- fail closed when the upstream binary hash is unknown instead of guessing

That is the whole bet. It is not trying to be a fork of Codex, a custom backend, or a traffic proxy.

## Trust Model

| Concern | This toolkit's contract |
| --- | --- |
| Credentials | It does not ask for your OpenAI password, proxy your prompts, or upload `auth.json` / `accounts/` anywhere. Auth switching works by managing the same local Codex auth files you already have under `~/.codex`. |
| Filesystem writes | It writes only to `~/.codex-multiaccount` for shims, overlays, manifests, and state. It reads `~/.codex` because that is where Codex auth already lives. It does not patch the upstream vendor binary in place. |
| Network access | Network use is narrow and explicit: fetch the configured manifest and download published overlays from GitHub Releases, or pull a newer toolkit package when you run `upgrade`. It does not sit in the middle of Codex API traffic. |
| Updates | The managed runtime can refresh its manifest/overlay state automatically. The toolkit package does not silently self-update; users must reinstall, run `codex-multiaccount upgrade`, or `self-install` from a checkout. |
| Breakage | Overlay selection is hash-matched. If the installed upstream Codex binary is unknown, launch fails closed instead of trying a near match. |
| Reversibility | `codex-multiaccount uninstall` removes the managed runtime and restores normal `codex` launch behavior. Your upstream Codex install and `~/.codex` auth data stay yours. |

## Before You Install

This project is meant for people who are comfortable auditing what a CLI touches on their own machine. If that is not you, wait for a better official multi-account workflow in Codex itself.

If it is you, the important facts are simple:

- it does not modify upstream Codex in place
- it does not invent a custom auth store
- it does not silently apply overlays for unknown upstream binaries
- it does not hide uninstall behind manual cleanup
- it is easiest to reason about on a personal machine, not a shared workstation

## Compared To Other Approaches

The main alternatives today are still auth-file switchers, small wrapper scripts, or profile managers that sit next to stock Codex. They solve part of the problem. This project is aimed at the full "switch accounts and keep the Codex runtime in sync" problem.

| Approach | Auth switching | Auto-switch | Runtime hot-reload fix | Cross-platform | Health check / fail-closed |
| --- | --- | --- | --- | --- | --- |
| Manual `auth.json` swapping | ✅ | ❌ | ❌ | ✅ | ❌ |
| [`codex-auth`](https://github.com/Loongphy/codex-auth) | ✅ | ✅ | ❌ | ✅ | ❌ |
| Simple switcher scripts | ✅ | ❌ | ❌ | ❌ | ❌ |
| Profile managers / wrappers | ✅ | sometimes | ❌ | sometimes | ❌ |
| `codex-multiaccount-patcher` | ✅ | ✅ | ✅ | ✅ | ✅ |

If you only want to swap auth snapshots manually, lighter tools are fine. If you want the auth manager and patched Codex runtime to stay aligned under one install, this is the stronger model.

## Flight Path

```mermaid
flowchart TD
    A[Installed upstream codex] --> B[patcher-owned shim]
    B --> C[hash upstream binary]
    C --> D{matching overlay in manifest?}
    D -->|yes| E[reuse cached overlay]
    D -->|no| F[fail closed]
    E --> G[launch patched codex]
    G --> H[reload auth snapshot between turns]
    H --> I[switch accounts without restarting]
```

That is the whole shape of the project: discover the real upstream binary, match it by exact hash, hydrate the right overlay, then launch the patched executable through a shim the patcher controls.

## Quickstart

1. Install Codex normally first. The toolkit expects an existing global `@openai/codex` install.
2. Install the toolkit itself:

```bash
npm install -g github:minanagehsalalma/codex-multiaccount-patcher
```

3. Install the managed Codex shims and pull the latest validated manifest:

```bash
codex-multiaccount install
```

4. Check the patched Codex runtime:

```bash
codex-multiaccount status
codex-multiaccount doctor
```

5. Check the bundled auth toolkit:

```bash
codex-multiaccount auth status
codex-multiaccount auth list
```

6. Enable auto-switch if you want the patcher and auth manager to work together hands-free:

```bash
codex-multiaccount config auto enable
codex-multiaccount config auto --5h 10 --weekly 1
```

If `auth status` already shows `auto-switch: ON`, leave it as-is. After that, plain `codex` should route through the managed shim automatically and keep picking up auth changes between turns. `codex-auth` is also installed as a compatibility alias, and the legacy alias `codex-hotpatch` still works during the transition.

7. Refresh the toolkit when a new published build lands:

```bash
codex-multiaccount upgrade
```

Maintainers working from a local checkout can refresh the global install from that checkout instead:

```bash
codex-multiaccount self-install
```

Published installs do not auto-refresh every time the repo changes. The toolkit upgrades the managed Codex runtime automatically, but the toolkit package itself only changes when you reinstall or run `upgrade`.

## Toolkit Home

The toolkit has two runtime roots:

- `~/.codex-multiaccount`
  This is the toolkit-managed home for shims, overlays, manifests, and patch runtime state.
- `~/.codex`
  This remains the upstream Codex home, and it is still the live source of truth for `auth.json`, `accounts/`, session rollouts, and the auth registry that `codex-auth` manages.

`codex-multiaccount doctor` checks both homes together so users do not have to guess which side is broken.

If you are evaluating the tool skeptically, `doctor` is the first command to run after install because it shows both the patch runtime and auth runtime in one place, including whether auto-switch is actually enabled.

## What Happens When You Type `codex`

```mermaid
sequenceDiagram
    participant You
    participant Shim as codex shim
    participant Patcher as codex-multiaccount
    participant Manifest as active manifest
    participant Cache as overlay cache
    participant Patched as patched codex

    You->>Shim: codex
    Shim->>Patcher: launch -- [args]
    Patcher->>Patcher: discover upstream binary + sha256
    Patcher->>Manifest: find exact platform/hash match
    Manifest-->>Patcher: overlay record
    Patcher->>Cache: ensure overlay exists locally
    Cache-->>Patcher: managed overlay path
    Patcher->>Patched: exec patched binary
    Patched-->>You: same Codex CLI, fixed auth reload behavior
```

<details>
<summary><strong>What install writes to the machine</strong></summary>

The patcher creates a managed home at `~/.codex-multiaccount`, stores overlay binaries under `overlays/`, writes the active manifest under `manifests/`, and places shims under `bin/`. It does not mutate the vendor Codex binary in place.

</details>

<details>
<summary><strong>Why updates survive better than direct patching</strong></summary>

When upstream Codex changes, the patcher hashes the new binary on the next launch and looks for a matching published overlay. If one exists, it switches cleanly. If one does not, it fails closed instead of silently launching a stale or mismatched binary.

</details>

<details>
<summary><strong>Why the release pipeline matters</strong></summary>

The runtime stays simple because the heavy work moves to CI: apply the maintained patch program, run the two focused regressions, build the overlays, generate the manifest, and only then publish a release that the CLI can consume.

</details>

## Release Pulse

```mermaid
flowchart LR
    A[detect upstream release] --> B[apply maintained patch program]
    B --> C[run focused regressions]
    C --> D[build Windows and Linux overlays]
    D --> E[generate manifest slices]
    E --> F[validate release URLs]
    F --> G[publish release]
```

The automation is designed to stop before publishing when the patch program drifts, a regression breaks, or the manifest points at the wrong repo/tag. That last check exists specifically to prevent the kind of release cleanup that makes a public release page look sloppy.

## Unattended Maintenance Loop

```mermaid
flowchart LR
    A[scheduled auto-maintain-upstream] --> B{release tag already exists?}
    B -->|yes| C[skip build and close tracked issue]
    B -->|no| D[call publish-hotpatch]
    D --> E{publish succeeded?}
    E -->|yes| F[release manifest and overlays]
    F --> G[close tracked issue]
    E -->|no| H[open or update tracked failure issue]
    H --> I[optionally assign Copilot cloud agent]
```

The green path is now zero-touch: detect the latest upstream Codex release, skip work if the matching patch release already exists, otherwise run the existing publish pipeline and close any tracked failure issue after success. Human attention is only pulled in when the deterministic path fails closed.

## Command Surface

| Command | Purpose |
| --- | --- |
| `codex-multiaccount install [--overlay-path <path>] [--manifest <file-or-url>] [--path <upstream-binary>] [--force]` | Install shims, discover upstream Codex, and materialize the matching overlay |
| `codex-multiaccount status` | Show upstream hash, active overlay, manifest source, and install health |
| `codex-multiaccount doctor` | Check both the patch runtime and auth runtime in one report |
| `codex-multiaccount upgrade` | Replace the global toolkit install with the latest published build from GitHub |
| `codex-multiaccount self-install` | Pack the current checkout and install it globally as a self-contained package |
| `codex-multiaccount repair` | Re-resolve the manifest and refresh the managed runtime |
| `codex-multiaccount uninstall` | Remove the managed runtime and restore normal `codex` launch behavior |
| `codex-multiaccount launch -- [codex args...]` | Internal entrypoint used by the managed shims |
| `codex-multiaccount auth <codex-auth args...>` | Run the bundled auth toolkit through the same install |
| `codex-multiaccount list` | Convenience alias for `codex-multiaccount auth list` |
| `codex-multiaccount login [--device-auth]` | Convenience alias for `codex-multiaccount auth login` |
| `codex-multiaccount switch [<query>]` | Convenience alias for `codex-multiaccount auth switch` |
| `codex-multiaccount remove ...` | Convenience alias for `codex-multiaccount auth remove` |
| `codex-multiaccount import ...` | Convenience alias for `codex-multiaccount auth import` |
| `codex-multiaccount clean` | Convenience alias for `codex-multiaccount auth clean` |
| `codex-multiaccount config ...` | Convenience alias for `codex-multiaccount auth config` |
| `codex-auth ...` | Backward-compatible shim to the bundled auth toolkit |

Normal users should usually need `install`, `status`, `doctor`, `auth status`, `auth list`, `config auto enable`, and `switch`.

## Auth Toolkit

The bundled auth engine is the same native `codex-auth` toolchain, now shipped behind this package so users do not have to install and coordinate a second CLI manually.

On Windows, the toolkit now prefers a vendored snapshot of the known-good working `codex-auth` machine install before falling back to any other copy. Existing standalone installs still work as a secondary fallback, and fresh installs can still fall back to the npm-bundled auth engine when needed.

```bash
codex-multiaccount auth status
codex-multiaccount auth list
codex-multiaccount switch work
codex-multiaccount config auto enable
codex-multiaccount config auto --5h 10 --weekly 1
```

The compatibility alias still works too:

```bash
codex-auth status
codex-auth list
```

## Maintained Patch Model

The repo no longer depends on hand-refreshing one giant patch for every Codex release. The durable part is a small patch program plus two regressions that prove the behavior still works.

| Layer | Role |
| --- | --- |
| [src/lib/maintained-patch.js](src/lib/maintained-patch.js) | Applies the runtime rewrite logic |
| [patches/codex-hot-reload-tests.patch](patches/codex-hot-reload-tests.patch) | Carries the smaller fallback test changes |
| `current_client_setup_reloads_auth_from_disk_between_turns` | Proves auth state reloads between turns |
| `responses_websocket_reconnects_when_auth_snapshot_changes_between_turns` | Proves websocket auth reconnects when the snapshot changes |

## CI Strategy

GitHub Actions stays the primary path because the repo already lives on GitHub and the workflow needs first-class Windows runners. The current setup optimizes for two lanes instead of one noisy everything-pipeline:

- [publish-hotpatch.yml](.github/workflows/publish-hotpatch.yml) publishes validated overlays and `manifest.json`
- [compatibility-sweep.yml](.github/workflows/compatibility-sweep.yml) pressure-tests multiple upstream versions without publishing

The compatibility sweep can run in `fast` mode for Linux-only validation or `full` mode for Linux plus Windows. The current baseline starts at Codex `0.119.0`, and the latest published validation snapshot is [Codex 0.121.0 validation](latest-validation-0.121.0.md).

A deeper note on CI speed and unattended maintenance is in [docs/CI-STRATEGY.md](docs/CI-STRATEGY.md).

## Maintainer Shortcuts

```bash
npm test
npm run patch:check -- --upstream-root <path>
npm run patch:apply -- --upstream-root <path>
npm run manifest:validate -- --manifest <path> --repo minanagehsalalma/codex-multiaccount-patcher --tag multiaccount-patcher-<version>
npm run upstream:detect
npm run upstream:fetch -- --codex-version <version> --platform <platform> --arch <arch> --output <path>
npm run versions:matrix -- --count 5 --min-version 0.119.0 --target-set fast
```

## Reality Check

| Topic | Current state |
| --- | --- |
| Windows x64 | Validated live end to end |
| Linux x64 | Supported in release + compatibility CI, still worth a real publish-install pass on Linux |
| Release automation | `auto-maintain-upstream` watches upstream Codex, skips already-published versions, and only opens a tracked issue when the deterministic path fails |
| CI ownership | GitHub Actions is the only maintained automation surface |
| Unsupported upstream builds | Launch fails closed until CI publishes a matching overlay |

## Acknowledgements

- [openai/codex](https://github.com/openai/codex) for the upstream Codex CLI this toolkit layers on top of
- [loongphy/codex-auth](https://github.com/loongphy/codex-auth) for the auth management toolchain this project integrates and ships behind the unified CLI

Trust files: [LICENSE](LICENSE), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md).
