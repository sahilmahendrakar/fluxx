'use strict';

/**
 * Build Electron main + preload into `.vite/build/` for Playwright validation.
 * Skips renderer, packaging, and dev-server startup — fast and idempotent.
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const MAIN_JS = path.join(REPO_ROOT, '.vite/build/main.js');
const PRELOAD_JS = path.join(REPO_ROOT, '.vite/build/preload.js');

function runViteBuild(configFile) {
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'vite', 'build', '--config', configFile],
    { cwd: REPO_ROOT, stdio: 'inherit', env: process.env },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  console.log('[build:validation] Building main process…');
  runViteBuild('vite.main.config.ts');

  console.log('[build:validation] Building preload script…');
  runViteBuild('vite.preload.config.ts');

  const fs = require('node:fs');
  for (const file of [MAIN_JS, PRELOAD_JS]) {
    if (!fs.existsSync(file)) {
      console.error(`[build:validation] expected output at ${file}`);
      process.exit(1);
    }
  }

  console.log('[build:validation] Done — .vite/build/main.js and preload.js are ready.');
}

if (require.main === module) {
  main();
}

module.exports = { REPO_ROOT, MAIN_JS, PRELOAD_JS };
