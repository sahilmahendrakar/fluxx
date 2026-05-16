/**
 * Resolve the user's interactive-login-shell environment so packaged macOS
 * builds can find tools like `agent`, `claude`, `codex`, `gh`, `brew`, etc.
 *
 * macOS GUI apps launched from Finder / Spotlight / Dock inherit the minimal
 * launchd PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), not the user's shell PATH
 * from `~/.zshrc`. Electron main inherits the same minimal env, so any
 * `pty.spawn('agent', ...)` from a packaged build fails with ENOENT — the PTY
 * child exits immediately and the UI surfaces "session has ended".
 *
 * We probe the user's shell once at main-process startup and merge the result
 * into `process.env` so PTY spawns inherit the corrected env automatically.
 *
 * Pattern is lifted from Superset's `packages/host-service/src/terminal/clean-shell-env.ts`
 * (the v2 strict probe — sentinel delimiter, locked spawn env, $HOME cwd,
 * timeout kill).
 */

import { type ChildProcess, spawn } from 'node:child_process';
import os from 'node:os';

/** Bounded probe — slow `.zshrc` (nvm, asdf, oh-my-zsh) is real and not pathological. */
const SHELL_ENV_TIMEOUT_MS = 8_000;

/** Success cache. Repeated probes during a single session would only waste shell startups. */
const CACHE_TTL_MS = 60_000;

/**
 * Bracket the `env` dump so anything `.zshrc` prints (banners, oh-my-zsh
 * status, brew warnings, etc.) does not corrupt parsing. The token is
 * unique enough to never collide with real env values.
 */
const DELIMITER = '__FLUX_SHELL_ENV_DELIM__';

/** Cap stdout/stderr we surface in error messages so logs do not blow up. */
const DIAGNOSTIC_OUTPUT_LIMIT = 200;

/**
 * Keys we let through from `process.env` when invoking the probe shell.
 * Everything else (NODE_*, ELECTRON_*, FLUX_*, etc.) is stripped so the
 * shell sees a clean bootstrap env and does not branch on stale state.
 *
 * Mirrors Superset's `SHELL_BOOTSTRAP_KEYS`.
 */
const SHELL_BOOTSTRAP_KEYS = [
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PATH',
  'TERM',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  '__CF_USER_TEXT_ENCODING',
  'Apple_PubSub_Socket_Render',
  'COMSPEC',
  'USERPROFILE',
  'SYSTEMROOT',
];

/**
 * Deterministic fallback paths used when shell probing fails entirely.
 * Covers the common macOS toolchain install locations so binaries like
 * `git`, `brew`, `gh` are reachable even with no shell help.
 */
const COMMON_MACOS_PATHS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
];

/**
 * Prepend well-known macOS toolchain dirs to `env.PATH` if missing.
 * Pure, no shell invocation — safe to call always as defense in depth.
 */
export function augmentPathForMacOS(
  env: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'darwin') return;
  const currentPath = env.PATH ?? '';
  const currentEntries = currentPath.split(':').filter(Boolean);
  const entrySet = new Set(currentEntries);
  const missing = COMMON_MACOS_PATHS.filter((p) => !entrySet.has(p));
  if (missing.length === 0) return;
  env.PATH = [...missing, currentPath].filter(Boolean).join(':');
}

function buildBootstrapEnv(): Record<string, string> {
  const env: Record<string, string> = {
    // Some shells try to auto-update on startup; we are not interactive,
    // and any prompt would deadlock the probe. Belt-and-suspenders.
    DISABLE_AUTO_UPDATE: 'true',
    // oh-my-zsh tmux plugin will exec into tmux if these aren't set, which
    // means the probe shell never exits and we hit the timeout.
    ZSH_TMUX_AUTOSTARTED: 'true',
    ZSH_TMUX_AUTOSTART: 'false',
  };
  for (const key of SHELL_BOOTSTRAP_KEYS) {
    const value = process.env[key];
    if (typeof value === 'string') env[key] = value;
  }
  augmentPathForMacOS(env);
  return env;
}

function resolveProbeShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/sh';
}

function parseEnvOutput(stdout: string): Record<string, string> {
  const parts = stdout.split(DELIMITER);
  // Expected: ["...preamble...", "envdump", "...trailing..."]
  if (parts.length < 2) {
    throw new Error('shell env output missing delimiter');
  }
  const dump = parts[1];
  const result: Record<string, string> = {};
  for (const line of dump.split('\n')) {
    if (!line) continue;
    const idx = line.indexOf('=');
    if (idx > 0) {
      result[line.slice(0, idx)] = line.slice(idx + 1);
    }
  }
  if (Object.keys(result).length === 0) {
    throw new Error('shell env output parsed empty');
  }
  return result;
}

function truncateForDiagnostics(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= DIAGNOSTIC_OUTPUT_LIMIT) return trimmed;
  return `${trimmed.slice(0, DIAGNOSTIC_OUTPUT_LIMIT)}…`;
}

function spawnProbeShell(): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const shell = resolveProbeShell();
    const env = buildBootstrapEnv();
    // `command env` bypasses any `env` shell function or alias the user may
    // have defined; `printf` for the delimiter so we do not pick up trailing
    // newlines that `echo`'s `-n` flag inconsistency would introduce across
    // shells (zsh/bash/dash differ here).
    const script = `printf '%s' "${DELIMITER}"; command env; printf '%s' "${DELIMITER}"; exit 0`;

    // Anchoring at $HOME avoids `brew` aborting on cwd-not-readable when
    // Electron helpers land at `/private/var/...`. Mirrors Superset's
    // workaround for their issue #4025.
    const cwd = env.HOME || os.homedir() || undefined;

    let child: ChildProcess;
    try {
      child = spawn(shell, ['-i', '-l', '-c', script], {
        // detached: own process group, so SIGKILL on timeout reaches every
        // grandchild .zshrc may have started (nvm, direnv, etc.) via
        // `process.kill(-pid, ...)`.
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        cwd,
      });
    } catch (err) {
      reject(
        new Error(
          `shell-env: failed to spawn ${shell}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => {
        // Kill the whole process group — `-pid` targets the group leader's
        // group, which catches any .zshrc-spawned children.
        if (typeof child.pid === 'number' && child.pid > 0) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            try {
              child.kill('SIGKILL');
            } catch {
              // Already exited.
            }
          }
        }
        reject(
          new Error(`shell-env: probe timed out after ${SHELL_ENV_TIMEOUT_MS}ms (shell=${shell})`),
        );
      });
    }, SHELL_ENV_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      settle(() => {
        reject(new Error(`shell-env: spawn error for ${shell}: ${err.message}`));
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      settle(() => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        if (code !== 0 && code !== null) {
          reject(
            new Error(
              `shell-env: ${shell} exited code=${code}` +
                (signal ? ` signal=${signal}` : '') +
                (stderr ? ` stderr=${truncateForDiagnostics(stderr)}` : '') +
                (stdout ? ` stdout=${truncateForDiagnostics(stdout)}` : ''),
            ),
          );
          return;
        }
        try {
          resolve(parseEnvOutput(stdout));
        } catch (parseErr) {
          const detail = parseErr instanceof Error ? parseErr.message : String(parseErr);
          reject(
            new Error(
              `shell-env: ${detail} (shell=${shell}` +
                ` stdout=${truncateForDiagnostics(stdout)}` +
                (stderr ? ` stderr=${truncateForDiagnostics(stderr)}` : '') +
                ')',
            ),
          );
        }
      });
    });

    // Allow the parent to exit even if the probe hangs (timer will kill).
    child.unref();
  });
}

let cached: Record<string, string> | null = null;
let cachedAt = 0;

/**
 * Probe the user's interactive-login shell for its env. Throws on any
 * failure — callers wanting graceful degradation should catch and fall back
 * to `process.env` plus `augmentPathForMacOS`.
 *
 * Result is cached for {@link CACHE_TTL_MS} so repeated calls do not respawn
 * the shell. Pass `{ forceRefresh: true }` to invalidate.
 */
export async function getUserShellEnv(
  options?: { forceRefresh?: boolean },
): Promise<Record<string, string>> {
  const now = Date.now();
  if (!options?.forceRefresh && cached && now - cachedAt < CACHE_TTL_MS) {
    return { ...cached };
  }
  const env = await spawnProbeShell();
  cached = env;
  cachedAt = now;
  return { ...cached };
}

export function clearUserShellEnvCacheForTests(): void {
  cached = null;
  cachedAt = 0;
}

/**
 * Merge the user's shell env into `process.env`, preferring existing values
 * so Electron- and Flux-managed vars stay intact. PATH is treated specially:
 * the shell-derived PATH replaces the inherited launchd minimal PATH so that
 * later `child_process.spawn` (and node-pty children) can
 * find `agent`, `claude`, `codex`, `gh`, `brew`, etc.
 *
 * On any failure: augment `process.env.PATH` with the well-known macOS
 * toolchain dirs and return. The app still boots; the user just may need
 * binaries installed under Homebrew's standard prefixes to be reachable.
 *
 * Call this once at startup, **synchronously awaited**, before spawning any
 * PTYs. Idempotent — subsequent calls hit the cache.
 */
export async function applyShellEnvToProcess(): Promise<void> {
  try {
    const shellEnv = await getUserShellEnv();
    for (const [key, value] of Object.entries(shellEnv)) {
      if (typeof process.env[key] !== 'string') {
        process.env[key] = value;
      }
    }
    // PATH is the whole point — overwrite the inherited minimal one.
    if (typeof shellEnv.PATH === 'string' && shellEnv.PATH.length > 0) {
      process.env.PATH = shellEnv.PATH;
    }
  } catch (err) {
    console.warn(
      `[shell-env] probe failed, falling back to deterministic PATH augmentation: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    // Defense in depth: even on success, ensure Homebrew slots are present
    // (catches the edge case where the user's shell drops them, or where
    // /opt/homebrew was installed after their last login shell init).
    const snapshot: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') snapshot[k] = v;
    }
    augmentPathForMacOS(snapshot);
    if (snapshot.PATH !== process.env.PATH) {
      process.env.PATH = snapshot.PATH;
    }
  }
}
