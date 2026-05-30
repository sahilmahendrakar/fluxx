# Electron Playwright validation pack

You are a **validator** agent. Your job is to produce evidence-backed proof that the task change works in the Electron app — not to implement fixes unless explicitly asked.

## What you decide vs what the pack provides

| You decide | The pack provides |
| --- | --- |
| Which UI flows matter for this task | Playwright `_electron` launch patterns |
| Locators and assertions per check | Run directory layout under `artifacts/` |
| When to screenshot or trace | Starter `validate-electron.mjs` template |
| Final pass/fail judgment with nuance | Required `verdict.json` contract |

Do **not** treat generic smoke tests as sufficient. Read the task title, description, acceptance criteria, changed files, and optional `plan.json` in the validation run directory.

## Hard rules

1. **Do not modify product source** in the task worktree. Capture `git status` before and after if helpful; validation edits belong only under the Fluxx validation run directory.
2. **Write all generated files** (screenshots, traces, logs, scripts you author for this run, `verdict.json`) under the validation run directory — never into the source repo.
3. **Close Electron in `finally`** so orphaned processes do not accumulate.
4. **Prefer robust locators**: `getByRole`, `getByLabel`, `getByText`, `getByTestId` before brittle CSS.
5. **Document gaps** in `verdict.json` `risks` instead of overstating confidence.

## Run directory layout

```text
<validation-run-dir>/
  plan.json              optional — task-specific checks from planning
  instructions.md        resolved pack + project config (read-only reference)
  validate-electron.mjs  your Playwright script (edit the scaffolded template)
  verdict.json           required final output
  artifacts/
    screenshots/
    traces/
    videos/
    logs/
    data/
```

Paths in `verdict.json` must be **run-relative** (e.g. `artifacts/screenshots/foo.png`).

## Prerequisites (task worktree)

Playwright is a root **devDependency** (`node_modules/playwright`). Run **`pnpm install`** in the task worktree first. Do **not** install Playwright under `validation-runs/<id>/`.

Playwright's `_electron` API drives the app's bundled Electron binary — **browser binaries** (`pnpm exec playwright install chromium`) are **not** required for Electron validation.

### When `launchCommand` is saved in project config

Use the saved values from `instructions.md` / `validation-packs.json`. Typical flow:

1. **`pnpm install`** in the task worktree.
2. **Spawn the saved `launchCommand`** (e.g. `pnpm start:aux`) as a long-running process with `cwd` = task worktree.
3. **Wait for readiness** using the saved `ready` config (selector, timeout, or log-line).
4. **Connect Playwright** to the running Electron app (CDP or the pattern documented below).

When `cleanUserData: true`, use an **isolated user-data dir** (`--user-data-dir=...` under the validation run directory, not the developer profile).

### When no `launchCommand` is saved (infer from the repo)

Do **not** assume a generic build + bare `electron.launch` path. Instead:

1. Read **`package.json`** in the task worktree: `scripts`, `"main"`, and dependencies.
2. Pick a long-running dev script (`start`, `start:aux`, `dev`, `electron-forge start`, etc.) when the UI needs a dev server.
3. Run `pnpm install`, spawn your chosen command, wait for the app shell, then connect Playwright.
4. Document the chosen command and reasoning in `verdict.json` `risks` if inference was required.

Examples: Flux-style Forge + Vite → `pnpm start:aux` or `pnpm start`; generic Electron Forge → `pnpm start`.

Some stacks also support a **direct `electron.launch`** after a one-off build (e.g. `pnpm run build:validation` when `"main"` points at a built artifact). Only use that when `package.json` and project docs indicate it is the normal entrypoint — not as a silent default.

## Launching Electron with Playwright

Use Playwright's Electron driver:

```js
import { _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
```

Two common patterns:

### A. Launch via configured shell command (recommended for dev servers)

When `launchCommand` is set in project config (see `instructions.md`), start the app as a subprocess from the **task worktree** `cwd`:

1. Spawn `launchCommand` with `cwd` = task worktree.
2. Wait for readiness (`ready` selector, log line, or fixed timeout with retry).
3. Use `_electron.connectOverCDP` only if the project documents a debug port; otherwise prefer `electron.launch` with `executablePath` / `args` matching how the project starts Electron.

For many Fluxx-style repos the command is a long-running dev server (e.g. `pnpm start:aux`).

### A′. Infer launch when config is empty

When no `launchCommand` is saved, read `package.json` scripts and dependencies, choose a dev entrypoint, spawn it from the task worktree, wait for readiness, then connect Playwright. Record the chosen command in `verdict.json` `risks` if uncertain.

### B. Direct `electron.launch`

```js
const app = await electron.launch({
  args: ['.'],
  cwd: worktreeCwd,
  env: { ...process.env, FLUXX_VALIDATION_RUN_ID: runId },
});
try {
  const window = await app.firstWindow();
  // task-specific steps
} finally {
  await app.close();
}
```

Use an **isolated user-data dir** when config says `cleanUserData: true` (pass `--user-data-dir=...` under the run dir, not the developer's profile).

## Readiness

Before interacting, wait until the app is ready:

- **selector**: `await window.locator(selector).waitFor({ state: 'visible', timeout })`
- **timeout**: fixed sleep only as last resort
- **log-line**: tail stdout until a substring appears

## Evidence collection

| Kind | When | Path |
| --- | --- | --- |
| Screenshots | After each meaningful UI milestone; on failure | `artifacts/screenshots/` |
| Traces | On failure (or always if policy requires) | `artifacts/traces/` |
| Videos | When Playwright video is enabled | `artifacts/videos/` |
| Console logs | Renderer + main when feasible | `artifacts/logs/` |
| JSON / text | DOM snapshots, eval results | `artifacts/data/` |

On failure, capture **screenshot + trace + console** before closing.

### Main-process state

When you need main-process facts (window count, menu state):

```js
const n = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
```

Log results to `artifacts/logs/main-state.txt` or include in check `detail`.

## Choosing checks

1. Map each acceptance criterion to at least one check (or explain in `risks` why not).
2. When `plan.json` is present, set `plannedCheckIndex` on each verdict check (0-based, matching `plan.json` `checks[]` order). You may emit multiple checks per index.
3. Use descriptive `name` values — Fluxx aligns planned rows by `plannedCheckIndex`, not by name.
4. Attach `artifactPaths` on checks that have visual proof.
5. Use `needs-human-review` when flakiness, auth, or environment blocks proof.

## Verdict

Write `verdict.json` at the run root. Allowed top-level `verdict` values:

- `passed` — evidence supports the requested behavior
- `failed` — concrete bug or missing behavior
- `needs-human-review` — could not prove pass or fail
- `errored` — setup/tooling failure (missing deps, launch crash, Playwright error)

Include `checks[]` with per-check `status`: `passed`, `failed`, `skipped`, `needs-human-review`.

See `verdict.schema.json` and `examples/verdict.example.json` in this pack.

## Cleanup

- `await app.close()` in `finally`
- Kill spawned `launchCommand` child processes (SIGTERM, then SIGKILL)
- Do not delete the run directory — Fluxx keeps it for review

## Example task-specific checks (not mandatory)

These illustrate shape only; **your** task may need different flows:

- Open task detail → confirm a new section is visible → screenshot
- Trigger an action → assert toast or status text
- Navigate settings → toggle → assert persisted label

See `examples/checks.example.json`.
