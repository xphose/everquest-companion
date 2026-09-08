# scripts/ — build, packaging, and test tooling

Utility scripts for building, branding, and verifying the app. Run everything with
Node installed and available on PATH.

## Assets & data

| Script | `npm run` | What it does |
| --- | --- | --- |
| `gen-icon.mts` | `gen:icon` | Generates `build/icon.png` + `build/icon.ico` (dark panel + gold "EQ" mark) with zero deps. Re-run after editing the glyph. |
| `fetch-packs.mts` | `fetch:packs` | Downloads the shipped voice pack (`alan-rickman`, pinned tag — see `src/main/data/defaultPacks.ts`) into `resources/soundpacks/`, converting the source `openpeon.json` to our `manifest.json` shape. **The audio is gitignored** (it stays out of the public repo) — run this after a fresh clone before `npm run dist`. Idempotent: only missing/empty files are re-downloaded. |
| `scrape-posky.ts` / `scrape-bosses.ts` | `scrape:posky` / `scrape:bosses` | Refresh quest / raid-target data (offline, committed output). |

## Fixture extractors (`tests/extract-*.mjs`) — run them under **tsx**

`tests/fixtures/*.log` is committed to a PUBLIC repo, so every extractor routes its slice
through the shared scrub. That scrub now lives in **`src/shared/logScrub.ts`** (TypeScript —
the same drop list also governs the log slice an in-app feedback report attaches);
`tests/fixture-scrub.mjs` is a thin shim that binds the self-`/who` carve-out to `Primitive`.

Because the import chain reaches a `.ts` file, run every extractor through the tsx loader:

```bash
node --import tsx tests/extract-combat-fixtures.mjs "$EQLOG"
```

That is exactly what the `fixtures:*` npm scripts do, so the invocation lives in
`package.json` instead of in someone's memory:

```bash
npm run fixtures:combat -- "$EQLOG"
```

(Node 22+/24 will type-strip `logScrub.ts` on its own, so a bare `node` happens to work today
— with a `MODULE_TYPELESS_PACKAGE_JSON` warning and no guarantee across versions. Use the
scripts.)

**The gate after ANY scrub change**: re-run every extractor against the live log and prove
`git diff --stat tests/fixtures/` is EMPTY. A byte-identical fixture tree is the only proof
that a change to the drop list changed nothing it was not meant to. Baseline first if the tree
is already dirty.

## Installer packaging

- **`seed-wincodesign.ps1`** — one-time, per-machine workaround for the winCodeSign
  extraction failure. electron-builder needs the winCodeSign toolchain (rcedit +
  signtool) to write the icon + version metadata into the exe. Its archive contains
  two macOS symlinks that can't be extracted on Windows without symlink privilege
  (Developer Mode), so extraction fails and `npm run dist` loops. This script
  extracts the archive with symlinks skipped straight into the cache dir
  electron-builder expects (`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`).
  Run it once, then `npm run dist` builds a branded, versioned (still **unsigned**)
  installer.

  ```powershell
  ./scripts/seed-wincodesign.ps1
  npm run dist
  ```

  Alternative: enable Windows **Developer Mode** (grants symlink privilege) and
  electron-builder extracts winCodeSign itself — then the seed script isn't needed.

## Clean-machine installer harnesses (Task #25)

Two harnesses verify the installer on a pristine Windows environment. Enable the desired Windows feature before running its wrapper.

### Windows Sandbox — full GUI launch test (`scripts/sandbox/`)

`installer-test.wsb` maps `release/` read-only + a `results/` folder read-write into
a disposable sandbox, and on logon runs `installer-test.ps1`, which silent-installs
the newest `everquest-companion-Setup-*.exe`, verifies the install path + Start-menu shortcut +
that the **app window process starts**, silent-uninstalls, checks cleanup, and writes
`PASS`/`FAIL` + details to `scripts/sandbox/results/result.txt`.

```powershell
# one-time: enable Windows Sandbox (Win11 Pro/Enterprise), then reboot
Enable-WindowsOptionalFeature -Online -FeatureName 'Containers-DisposableClientVM' -All
# run:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sandbox\run-installer-test.ps1
# then read scripts\sandbox\results\result.txt
```

The tracked `.wsb` files are templates; always launch them through their wrappers.
Both `run-installer-test.ps1` and `run-smoke-feedback.ps1` resolve the checkout from
`$PSScriptRoot`, generate XML-escaped mappings, and put the local configuration and
results in `scripts/sandbox/results/`. They support these optional parameters:

- `-RepositoryRoot <path>` selects another checkout containing the harness and installer.
- `-ResultsDirectory <path>` selects a dedicated results directory. Relative paths resolve
  beneath the selected checkout; absolute paths can keep results outside it.
- `-ConfigurationOnly` writes the configuration and prints its path without starting or
  stopping a VM, loading the window-management code, or contacting a service.

Generated `*.generated.wsb` files contain resolved local paths and must remain untracked.
The feedback smoke test is still an explicit post-release operation against the configured
live service; configuration-only verification does not run it.

The feedback wrapper requires an explicit installer source: `-InstallerPath <local.exe>`
or `-ReleaseOwner <owner> -ReleaseRepo <repo>`. The latter also reads `EQC_RELEASE_OWNER`
and `EQC_RELEASE_REPO` from the build environment. A local installer is staged with a SHA-256
checksum; a release download still verifies its published `SHA256SUMS.txt` before installation.
The installer must itself have the intended feedback/telemetry deployment compiled in.

### Windows containers — file-level verification (`scripts/docker/`)

`Dockerfile` (Server Core) silent-installs and asserts the app exe + uninstaller are
laid down, then silent-uninstalls and asserts cleanup — all at the file level (no
GUI). A failed check throws so `docker build` fails.

```powershell
# requires Windows containers (Docker Desktop → Switch to Windows containers)
docker build -f scripts/docker/Dockerfile -t everquest-companion-installer-test .
docker run --rm everquest-companion-installer-test
```

## CI (`.github/workflows/build.yml`)

- **push to `main`** → publishes a GitHub **prerelease** on the `main` update channel,
  version stamped `<pkg>-main.<run_number>` (CI-only edit).
- **push tag `v*`** → publishes a full GitHub **release** on the `latest` channel.

Both use `GITHUB_TOKEN` (no extra secrets). The app is unsigned.
