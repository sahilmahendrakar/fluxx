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

## Launching Electron with Playwright

Use Playwright's Electron driver:

```js
import { _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
```

Two common patterns:

### A. Launch via configured shell command (recommended for dev servers)

When `launchCommand` is set in project config (see `instructions.md`), start the app as a subprocess from the **task worktree** `cwd`, then connect Playwright to the running app if your stack supports it, or use `electron.launch` with the same env the command would set.

For many Fluxx-style repos the command is a long-running dev server (e.g. `pnpm start:aux`). Typical approach:

1. Spawn `launchCommand` with `cwd` = task worktree.
2. Wait for readiness (`ready` selector, log line, or fixed timeout with retry).
3. Use `_electron.connectOverCDP` only if the project documents a debug port; otherwise prefer `electron.launch` with `executablePath` / `args` matching how the project starts Electron.

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
