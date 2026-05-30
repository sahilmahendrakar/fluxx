/**
 * Electron Playwright validation script (run-local).
 * Generated for validation run: {{RUN_ID}}
 *
 * Edit task-specific checks below. Do not write artifacts outside RUN_DIR.
 * Requires: `playwright` from the task worktree root (`pnpm install` at repo root).
 * When LAUNCH_COMMAND is set, spawns that dev entrypoint and connects via CDP.
 * When unset, inspect package.json and customize launch before UI checks (see launchApp).
 */
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { _electron as electron } from 'playwright';

const RUN_DIR = {{RUN_DIR_JSON}};
const WORKTREE_CWD = {{WORKTREE_CWD_JSON}};
const RUN_ID = {{RUN_ID_JSON}};
const LAUNCH_COMMAND = {{LAUNCH_COMMAND_JSON}};
const READY = {{READY_JSON}};
const CLEAN_USER_DATA = {{CLEAN_USER_DATA_JSON}};

const ARTIFACTS = {
  screenshots: path.join(RUN_DIR, 'artifacts/screenshots'),
  traces: path.join(RUN_DIR, 'artifacts/traces'),
  logs: path.join(RUN_DIR, 'artifacts/logs'),
  data: path.join(RUN_DIR, 'artifacts/data'),
};

const VALIDATION_USER_DATA_DIR = path.join(ARTIFACTS.data, 'electron-user-data');

async function ensureArtifactDirs() {
  for (const dir of Object.values(ARTIFACTS)) {
    await fs.mkdir(dir, { recursive: true });
  }
  if (CLEAN_USER_DATA) {
    await fs.mkdir(VALIDATION_USER_DATA_DIR, { recursive: true });
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

function buildLaunchEnv() {
  const env = {
    ...process.env,
    FLUXX_VALIDATION_RUN_ID: RUN_ID,
  };
  if (CLEAN_USER_DATA) {
    env.FLUXX_VALIDATION_USER_DATA_DIR = VALIDATION_USER_DATA_DIR;
  }
  return env;
}

function electronLaunchArgs() {
  const args = ['.'];
  if (CLEAN_USER_DATA) {
    args.push(`--user-data-dir=${VALIDATION_USER_DATA_DIR}`);
  }
  return args;
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

function spawnLaunchCommand(launchEnv) {
  const logPath = path.join(ARTIFACTS.logs, 'launch-command.log');
  const logFd = openSync(logPath, 'a');
  const child = spawn(LAUNCH_COMMAND, {
    cwd: WORKTREE_CWD,
    env: launchEnv,
    stdio: ['ignore', logFd, logFd],
    shell: true,
    detached: process.platform !== 'win32',
  });
  child.on('exit', () => {
    try {
      closeSync(logFd);
    } catch {
      /* ignore */
    }
  });
  child.unref?.();
  return child;
}

async function stopLaunchChild(child) {
  if (!child || child.killed) return;
  try {
    if (child.pid && process.platform !== 'win32') {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  await new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        if (child.pid && process.platform !== 'win32') {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* ignore */
      }
      resolve();
    }, 8_000);
    child.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
  });
}

async function discoverCdpEndpoint(timeoutMs = 120_000) {
  const portEnv = process.env.FLUXX_VALIDATION_CDP_PORT;
  const ports = portEnv
    ? [Number(portEnv)]
    : [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const port of ports) {
      if (!Number.isFinite(port) || port <= 0) continue;
      const endpoint = `http://127.0.0.1:${port}`;
      try {
        const res = await fetch(`${endpoint}/json/version`);
        if (res.ok) return endpoint;
      } catch {
        /* retry */
      }
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    'CDP endpoint not found after spawning launchCommand — ensure the dev entrypoint exposes remote debugging (e.g. --remote-debugging-port) or adjust connection per pack instructions.',
  );
}

async function connectViaLaunchCommand(launchEnv) {
  const child = spawnLaunchCommand(launchEnv);
  try {
    const endpoint = await discoverCdpEndpoint();
    const app = await electron.connectOverCDP(endpoint);
    return { app, child };
  } catch (err) {
    await stopLaunchChild(child);
    throw err;
  }
}

/**
 * No saved launchCommand — agent should read package.json scripts and spawn the dev
 * entrypoint (e.g. electron-forge start, start:aux) before UI checks, or customize
 * electron.launch below. Replace this stub when inferring launch from the repo.
 */
async function launchAppWithoutSavedCommand(launchEnv) {
  // TODO(agent): inspect WORKTREE_CWD/package.json, spawn inferred dev command, then connect.
  return electron.launch({
    args: electronLaunchArgs(),
    cwd: WORKTREE_CWD,
    env: launchEnv,
    timeout: 120_000,
  });
}

async function launchApp(launchEnv) {
  if (LAUNCH_COMMAND) {
    return connectViaLaunchCommand(launchEnv);
  }
  const app = await launchAppWithoutSavedCommand(launchEnv);
  return { app, child: null };
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
  const launchEnv = buildLaunchEnv();
  let app = null;
  let launchChild = null;

  try {
    ({ app, child: launchChild } = await launchApp(launchEnv));
    const window = await app.firstWindow();
    await waitForReady(window);
    const result = await runChecks(window);
    const risks = LAUNCH_COMMAND
      ? [
          `Launched via configured command (${LAUNCH_COMMAND}); did not verify production/packaged build.`,
          'Connected over CDP — confirm remote debugging is enabled for your dev entrypoint.',
        ]
      : [
          'No saved launchCommand — used placeholder electron.launch; document inferred dev command in risks if you customized launch.',
          'Did not verify production/packaged build.',
        ];
    await writeVerdict({
      verdict: 'passed',
      summary: 'Placeholder validation completed; replace runChecks with task-specific assertions.',
      ...result,
      risks,
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
    if (app) {
      try {
        await app.close();
      } catch {
        /* ignore */
      }
    }
    if (launchChild) {
      await stopLaunchChild(launchChild);
    }
  }
}

await main();
