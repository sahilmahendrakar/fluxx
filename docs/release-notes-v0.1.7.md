## Fluxx 0.1.7

Download for macOS:

- **Apple Silicon (M1/M2/M3/M4):** [Fluxx-arm64.dmg](https://github.com/sahilmahendrakar/fluxx/releases/latest/download/Fluxx-arm64.dmg)
- **Intel Mac:** [Fluxx-x64.dmg](https://github.com/sahilmahendrakar/fluxx/releases/latest/download/Fluxx-x64.dmg)

Auto-update builds fetch the matching `Fluxx-darwin-{arch}-0.1.7.zip` via `latest-mac.yml` on this release (Apple Silicon installs use the arm64 zip).

### Highlights

- **First-run global onboarding** — Full-screen welcome flow to pick a default agent, probe installed CLIs (`claude`, `agent`, `codex`, `gh`), and optionally enable GitHub features. Your agent choice becomes the default for new projects.
- **Gitless / folder-only mode** — Turn off git integration per project (or during onboarding) to work in plain folders without worktrees, branch pickers, or PR UI. Task sessions run directly in the bound folder locally and over SSH.
- **Validation pack configuration** — Configure Electron Playwright validation from Project settings; saved config flows into validator prompts and scaffold templates.
- **Planning docs improvements** — Delete planning markdown from the Docs UI with cloud sync to Firestore; nested folder dropdowns in the Docs sidebar.

### Global onboarding

- New users see a three-step flow: Welcome → Agent selection → GitHub CLI.
- CLI probes show Detected / Not installed / Check failed / Timed out badges per tool.
- Selected agent is persisted globally and applied as the default planning and task agent for new projects.
- **Enable GitHub features** toggle (when `gh` is installed): turning it off defaults new projects to gitless mode (`gitIntegrationEnabled: false`).
- Onboarding can be re-run for QA with `FLUXX_FORCE_GLOBAL_ONBOARDING=1` without clearing app data.

### Gitless mode

- **Project settings → Git integration** toggle to disable git workflows for a project.
- Non-git folders can be used for local and cloud project onboarding when git integration is off.
- Git/PR/branch UI is hidden; PR automations (auto-move to Review, auto-mark Done) are disabled.
- Local task sessions use the repo folder directly instead of worktrees.
- SSH task sessions run in a bound remote folder when no git repo is available.
- Fluxx CLI git branch flags are ignored with a clear notice when git integration is off.

### Other improvements

- Open PR icons on Review-column tasks use review blue when a PR is linked.
- Cursor Agent terminal theme syncs with Fluxx light/dark appearance.
- Electron Playwright validation: project settings UI, config persistence, and smarter validator launch inference.
- Planning doc deletes propagate to Firestore for cloud projects.
- Docs sidebar: nested folder dropdowns for planning markdown.
- Light-mode polish for settings page and Validate button in task detail.
- Fix intermittent terminal resize when opening task workspace tabs.
- Fix agent dropdown closing before selection in task and planning menus.
- Fix task detail crash from a React hooks order violation.
- SSH session freezing fixes.

### Install

1. Download the DMG for your Mac’s chip (Apple Silicon or Intel).
2. Drag **Fluxx** to Applications.
3. Launch from Applications; approve in System Settings if macOS prompts.

Existing installs should auto-update if you’re on a recent build with the updater enabled.
