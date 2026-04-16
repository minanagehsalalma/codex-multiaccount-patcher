Bundled from the working machine install on `C:\Users\ASUS\AppData\Roaming\npm\node_modules\@loongphy\codex-auth`.

Snapshot contents intentionally include only the code needed at runtime:

- root launcher `bin/codex-auth.js`
- root `package.json` and `LICENSE`
- Windows x64 platform package metadata
- `codex-auth.exe`
- `codex-auth-auto.exe`

Excluded on purpose:

- live auth/account data
- backup `.bak-*` binaries
- user-specific registry or snapshot files

This snapshot is preferred first on Windows so the toolkit reuses the exact machine-verified auth code path before falling back to other installs.
