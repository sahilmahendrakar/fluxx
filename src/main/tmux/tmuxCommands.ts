import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getFluxxTmuxConfigPath } from './resolveFluxxTmuxConfigPath';

const execFileAsync = promisify(execFile);

import { isAuxDevInstance } from '../auxDevInstance';

/** Isolated tmux server so `-f fluxx-tmux.conf` is not ignored by a user default server. */
export const FLUXX_TMUX_SOCKET_NAME = 'fluxx';

/** Secondary dev instance socket (`pnpm run start:aux`). */
export const FLUXX_TMUX_AUX_SOCKET_NAME = 'fluxx-aux';

/** Env override for tests; `start:aux` sets this to {@link FLUXX_TMUX_AUX_SOCKET_NAME}. */
export const FLUXX_TMUX_SOCKET_NAME_ENV = 'FLUXX_TMUX_SOCKET_NAME';

export function resolveFluxxTmuxSocketName(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env[FLUXX_TMUX_SOCKET_NAME_ENV]?.trim();
  if (explicit) return explicit;
  if (isAuxDevInstance(env)) return FLUXX_TMUX_AUX_SOCKET_NAME;
  return FLUXX_TMUX_SOCKET_NAME;
}

/** Prefix every Fluxx tmux invocation with `-L <socket> -f <bundled fluxx-tmux.conf>`. */
export function buildFluxxTmuxArgv(subcommandArgs: string[]): string[] {
  return [
    '-L',
    resolveFluxxTmuxSocketName(),
    '-f',
    getFluxxTmuxConfigPath(undefined, process.execPath),
    ...subcommandArgs,
  ];
}

export async function tmuxHasSession(sessionName: string): Promise<boolean> {
  try {
    await execFileAsync('tmux', buildFluxxTmuxArgv(['has-session', '-t', sessionName]), {
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function tmuxKillSession(sessionName: string): Promise<void> {
  try {
    await execFileAsync('tmux', buildFluxxTmuxArgv(['kill-session', '-t', sessionName]), {
      timeout: 5_000,
    });
  } catch {
    /* session may already be gone */
  }
}

export async function tmuxNewDetachedSession(args: string[]): Promise<void> {
  await execFileAsync('tmux', buildFluxxTmuxArgv(['new-session', '-d', ...args]), {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
}

/** Lists all tmux session names (empty when tmux server is not running). */
export async function tmuxListSessionNames(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'tmux',
      buildFluxxTmuxArgv(['list-sessions', '-F', '#S']),
      {
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      },
    );
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((name) => name.length > 0);
  } catch {
    return [];
  }
}
