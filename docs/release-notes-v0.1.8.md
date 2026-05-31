## Fluxx 0.1.8

Download for macOS:

- **Apple Silicon (M1/M2/M3/M4):** [Fluxx-arm64.dmg](https://github.com/sahilmahendrakar/fluxx/releases/latest/download/Fluxx-arm64.dmg)
- **Intel Mac:** [Fluxx-x64.dmg](https://github.com/sahilmahendrakar/fluxx/releases/latest/download/Fluxx-x64.dmg)

Auto-update builds fetch the matching `Fluxx-darwin-{arch}-0.1.8.zip` via `latest-mac.yml` on this release (Apple Silicon installs use the arm64 zip).

### Highlights

- **Global onboarding refresh** — Re-run agent CLI detection from the agent selection step after installing a CLI mid-flow, without restarting onboarding.
- **Gitless folder onboarding fix** — Adding a plain folder works when git integration is turned off; the app no longer requires a `.git` directory in that mode.

### Install

1. Download the DMG for your Mac’s chip (Apple Silicon or Intel).
2. Drag **Fluxx** to Applications.
3. Launch from Applications; approve in System Settings if macOS prompts.

Existing installs should auto-update if you’re on a recent build with the updater enabled.
