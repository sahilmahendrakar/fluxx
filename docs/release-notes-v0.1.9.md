## Fluxx 0.1.9

Download for macOS:

- **Apple Silicon (M1/M2/M3/M4):** [Fluxx-arm64.dmg](https://github.com/sahilmahendrakar/fluxx/releases/latest/download/Fluxx-arm64.dmg)
- **Intel Mac:** [Fluxx-x64.dmg](https://github.com/sahilmahendrakar/fluxx/releases/latest/download/Fluxx-x64.dmg)

Auto-update builds fetch the matching `Fluxx-darwin-{arch}-0.1.9.zip` via `latest-mac.yml` on this release (Apple Silicon installs use the arm64 zip).

### Highlights

- **Refreshed agent model presets** — The task model pickers now list current models: Fable 5, Opus 5, and Sonnet 5 for Claude Code; GPT 5.6 Sol, Terra, and Luna for Codex; Opus/Sonnet/Fable 5 Thinking, GPT 5.6 Sol, and Composer 2.5 for Cursor Agent. Two Cursor presets that no longer exist upstream (`claude-sonnet-4-6`, `composer-2`) have been removed. Tasks already pinned to an older model keep working, and custom models you added yourself are untouched.
- **Sensitive settings fields stay editable** — Secret-bearing project settings fields no longer need an explicit reveal before you can type in them; Hide is now opt-in.

### Install

1. Download the DMG for your Mac’s chip (Apple Silicon or Intel).
2. Drag **Fluxx** to Applications.
3. Launch from Applications; approve in System Settings if macOS prompts.

Existing installs should auto-update if you’re on a recent build with the updater enabled.
