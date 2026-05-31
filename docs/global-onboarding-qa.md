# Global onboarding — manual QA

Automated coverage lives in:

- `src/globalOnboarding/globalOnboardingState.test.ts` — normalization, migration, force override, patches
- `src/main/AppStateStore.globalOnboarding.test.ts` — disk migration and skip/complete persistence
- `src/main/globalOnboardingCliProbe.test.ts` — CLI probe found/missing/error/timeout
- `src/main/registerGlobalOnboardingIpc.test.ts` — renderer IPC payload shapes
- `src/globalOnboarding/globalDefaultAgent.test.ts` — global default agent application

Use the **aux dev instance** so QA never touches your real Fluxx profile. `pnpm start:aux` launches Electron with `--user-data-dir=.flux-test-userdata` (repo-local, gitignored).

## Fresh-user flow (`pnpm start:aux`)

1. From the repo root, run `pnpm start:aux`.
2. Confirm the full-screen global onboarding flow appears after activation loading (covers the project picker or main shell).
3. **Welcome step**
   - “Welcome to Fluxx!” with short intro copy; **Get started** advances to agent selection.
4. **Agent step**
   - Probe badges show per CLI (`claude`, `agent`, `codex`): Detected / Not installed / Check failed / Timed out.
   - Select an agent and continue; selection should persist in `.flux-test-userdata` (not your normal app data).
5. **GitHub CLI step**
   - If `gh` is on PATH: success state with a check icon.
   - If missing: “Download GitHub CLI” links to https://cli.github.com/ (no inline install steps).
6. **Skip**
   - From any step, use **Skip for now** in the header; quit and restart `pnpm start:aux` — onboarding must not reappear.
7. **Complete**
   - Run through all three steps with **Get started** / **Continue** / **Finish**; restart — flow stays hidden.
8. Optional: open or create a project and confirm planning/task agent defaults match the global selection.

To reset aux state only, delete `.flux-test-userdata/` in the repo root and run `pnpm start:aux` again.

## Force override (no data deletion)

Re-run onboarding without clearing real user data:

```bash
FLUXX_FORCE_GLOBAL_ONBOARDING=1 pnpm start:aux
```

- Dialog shows even if onboarding was previously skipped or completed in the aux profile.
- `getState` reports `forced: true` and effective `status: 'pending'` until you skip or complete again (stored status on disk is unchanged until you act).

Use the same command on your primary dev instance only if you accept showing onboarding against your normal profile; prefer aux for routine QA.

## Light and dark appearance

Record screenshots or short notes for each theme while the full-screen flow is open.

| Check | Light | Dark |
| --- | --- | --- |
| Full-screen background, header/footer borders, titles readable | | |
| Welcome headline and body copy | | |
| Outline-style Continue / Get started / Finish (no filled primary) | | |
| Agent cards: default, selected (`border-primary`), disabled | | |
| Probe badges: found (success), missing (muted), error/timeout (needs-input) | | |
| Primary actions (Continue / Finish) and ghost Skip | | |
| GitHub step: success alert vs missing + external link | | |
| Skeleton/spinner while probes load | | |

Toggle appearance in app settings (or system theme when set to **System**). Verify semantic tokens only — no hard-coded light colors bleeding into dark mode.

## Regression spot-check

After onboarding QA, run:

```bash
pnpm exec vitest run \
  src/theme/appearance.test.ts \
  src/main/projectOnboarding.test.ts \
  src/projectCreate.test.ts \
  src/components/newProject/newProjectWizard.test.ts
```

All should pass alongside the global onboarding test files listed above.
