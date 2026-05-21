import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TmuxAvailability } from '../types';

const execFileAsync = promisify(execFile);

/**
 * Probes whether `tmux` is on PATH and responds to `-V`.
 * Phase 1 only validates availability when enabling {@link persistTerminalsWithTmux};
 * no tmux sessions are started until a later phase.
 */
export async function probeTmuxAvailability(): Promise<TmuxAvailability> {
  if (process.platform === 'win32') {
    return {
      available: false,
      message:
        'tmux persistence is available on macOS and Linux when tmux is installed. Native Windows is not supported.',
    };
  }
  try {
    const { stdout } = await execFileAsync('tmux', ['-V'], {
      timeout: 5_000,
      windowsHide: true,
    });
    const version = typeof stdout === 'string' ? stdout.trim() : '';
    if (!version.toLowerCase().includes('tmux')) {
      return {
        available: false,
        message: 'tmux did not return a version string. Install tmux and ensure it is on PATH.',
      };
    }
    return { available: true };
  } catch {
    return {
      available: false,
      message:
        'tmux was not found on PATH. Install tmux (e.g. brew install tmux) and try again.',
    };
  }
}

/** Actionable error when saving persistTerminalsWithTmux while tmux is unavailable. */
export function tmuxUnavailableSaveError(availability: TmuxAvailability): string {
  return (
    availability.message ??
    'tmux is required to persist terminals. Install tmux and ensure it is on PATH.'
  );
}
