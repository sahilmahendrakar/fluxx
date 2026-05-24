'use strict';

/**
 * Secondary dev instance (`pnpm run start:aux`). Picks the first free TCP port
 * starting at 5180 so a stale aux or other process does not block startup.
 */
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_START_PORT = 5180;
const DEFAULT_MAX_ATTEMPTS = 32;

function parsePositiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && Number.isInteger(n) ? n : fallback;
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort, maxAttempts) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(
    `No free port in range ${startPort}–${startPort + maxAttempts - 1}.`,
  );
}

async function main() {
  const startPort = parsePositiveInt(process.env.FLUX_AUX_DEV_PORT_START, DEFAULT_START_PORT);
  const maxAttempts = parsePositiveInt(
    process.env.FLUX_AUX_DEV_PORT_ATTEMPTS,
    DEFAULT_MAX_ATTEMPTS,
  );
  const port = await findAvailablePort(startPort, maxAttempts);

  if (port !== startPort) {
    console.warn(`[start:aux] Port ${startPort} is in use; using ${port} instead.`);
  } else {
    console.log(`[start:aux] Using dev server port ${port}.`);
  }

  const env = {
    ...process.env,
    FLUX_AUX_DEV_SERVER_PORT: String(port),
    FLUXX_TMUX_SOCKET_NAME: 'fluxx-aux',
  };

  const child = spawn(
    'electron-forge',
    ['start', '--', '--user-data-dir=.flux-test-userdata'],
    {
      cwd: REPO_ROOT,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );

  child.on('error', (err) => {
    console.error('[start:aux] failed to launch electron-forge:', err.message);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[start:aux]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_START_PORT,
  findAvailablePort,
  isPortAvailable,
  parsePositiveInt,
};
