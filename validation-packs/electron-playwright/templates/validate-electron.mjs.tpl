/**
 * Electron Playwright validation script (run-local).
 * Generated for validation run: {{RUN_ID}}
 *
 * Edit task-specific checks below. Do not write artifacts outside RUN_DIR.
 * Requires: `playwright` from the task worktree root (`pnpm install` at repo root).
 * Requires: `.vite/build/main.js` — run `pnpm run build:validation` in the task worktree before `electron.launch`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const RUN_DIR = {{RUN_DIR_JSON}};
const WORKTREE_CWD = {{WORKTREE_CWD_JSON}};
const RUN_ID = {{RUN_ID_JSON}};
const LAUNCH_COMMAND = {{LAUNCH_COMMAND_JSON}};
const READY = {{READY_JSON}};

const ARTIFACTS = {
  screenshots: path.join(RUN_DIR, 'artifacts/screenshots'),
  traces: path.join(RUN_DIR, 'artifacts/traces'),
  logs: path.join(RUN_DIR, 'artifacts/logs'),
  data: path.join(RUN_DIR, 'artifacts/data'),
};

async function ensureArtifactDirs() {
  for (const dir of Object.values(ARTIFACTS)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function writeVerdict(partial) {
  const verdictPath = path.join(RUN_DIR, 'verdict.json');
  const body = {
    verdict: 'errored',
    summary: 'Validation did not complete.',
    checks: [],
    ...partial,
  };
  await fs.writeFile(verdictPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

async function waitForReady(window) {
  if (!READY || READY.type === 'timeout') {
    const ms = READY?.ms ?? 15_000;
    await window.waitForTimeout(ms);
    return;
  }
  if (READY.type === 'selector') {
    await window.locator(READY.value).waitFor({ state: 'visible', timeout: READY.timeoutMs ?? 120_000 });
    return;
  }
  throw new Error(`Unsupported ready.type: ${READY?.type}`);
}

/** Task-specific validation — replace the placeholder check. */
async function runChecks(window) {
  const screenshotPath = path.join(ARTIFACTS.screenshots, 'initial-window.png');
  await window.screenshot({ path: screenshotPath });
  return {
    checks: [
      {
        name: 'App window loads',
        status: 'passed',
        detail: 'Captured initial window screenshot.',
        artifactPaths: [path.relative(RUN_DIR, screenshotPath)],
      },
    ],
    artifacts: [
      {
        kind: 'screenshot',
        label: 'Initial window',
        path: path.relative(RUN_DIR, screenshotPath),
      },
    ],
  };
}

async function main() {
  await ensureArtifactDirs();
  const launchEnv = {
    ...process.env,
    FLUXX_VALIDATION_RUN_ID: RUN_ID,
  };

  // Direct launch — customize args/cwd for your Electron app.
  // When using LAUNCH_COMMAND, spawn it from WORKTREE_CWD and connect per project docs.
  const app = await electron.launch({
    args: ['.'],
    cwd: WORKTREE_CWD,
    env: launchEnv,
  });

  try {
    const window = await app.firstWindow();
    await waitForReady(window);
    const result = await runChecks(window);
    await writeVerdict({
      verdict: 'passed',
      summary: 'Placeholder validation completed; replace runChecks with task-specific assertions.',
      ...result,
      risks: LAUNCH_COMMAND
        ? [`Launch command configured (${LAUNCH_COMMAND}) but this template uses electron.launch directly.`]
        : ['Did not verify production/packaged build.'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeVerdict({
      verdict: 'errored',
      summary: 'Validation script failed.',
      error: message,
      checks: [
        {
          name: 'Run validation script',
          status: 'failed',
          detail: message,
        },
      ],
    });
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

await main();
