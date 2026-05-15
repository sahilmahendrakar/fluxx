# macOS releases and GitHub auto-update feed

Flux’s packaged macOS builds read update metadata from **`sahilmahendrakar/flux-web`** on GitHub Releases using `electron-updater`. Windows and Linux are unchanged and do not use this feed.

## What gets uploaded

On `electron-forge publish`, the GitHub publisher attaches make artifacts to a release for the app version. For macOS updates, every **latest** stable release must include at least:

1. The **zip** from `@electron-forge/maker-zip` (e.g. `Flux-darwin-arm64-0.1.1.zip`).
2. **`latest-mac.yml`** in the same release. Forge’s `postMake` hook generates this file next to the zip (checksums + filenames) so `electron-updater` can resolve the download URL.

The DMG is still useful for first install; the zip is what the updater installs.

## Commands

From a macOS machine (signed/notarized as you already do elsewhere):

```bash
pnpm publish
```

This runs Electron Forge publish, which uploads to `sahilmahendrakar/flux-web` when configured.

## Environment variables

| Variable | Required for | Notes |
|----------|----------------|-------|
| `GITHUB_TOKEN` | `pnpm publish` / `electron-forge publish` | Personal access token or CI token with **`contents: write`** on `flux-web` so releases and assets can be created or updated. The GitHub publisher reads this env var automatically. |
| `APPLE_ID` | `pnpm make` notarization | Already used in `forge.config.ts` `osxNotarize`. |
| `APPLE_PASSWORD` | notarization | App-specific password. |
| `APPLE_TEAM_ID` | notarization | Apple Developer Team ID. |

## App runtime

- **`autoUpdater.autoDownload`** is **`false`**; no installer is fetched unless you call `downloadUpdate()` explicitly later.
- **`FLUX_DISABLE_GITHUB_UPDATES=1`** turns off configuring the updater and rejects update checks via IPC.

To verify the feed from an installed build, use the preload API **`window.electronAPI.updates.checkGithubMac()`** (macOS packaged only). That runs `checkForUpdates()` and reports whether a newer semver is advertised on GitHub; it still does **not** start a background download.

## Private repos

Public `flux-web` needs no GitHub auth for clients to **read** release assets. For a private releases repo later, configure `electron-updater` auth (token / `addAuthHeader`) in addition to publisher credentials — not required for the public launch repo.
