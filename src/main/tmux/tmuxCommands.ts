import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function tmuxHasSession(sessionName: string): Promise<boolean> {
  try {
    await execFileAsync('tmux', ['has-session', '-t', sessionName], {
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function tmuxKillSession(sessionName: string): Promise<void> {
  try {
    await execFileAsync('tmux', ['kill-session', '-t', sessionName], {
      timeout: 5_000,
    });
  } catch {
    /* session may already be gone */
  }
}

export async function tmuxNewDetachedSession(args: string[]): Promise<void> {
  await execFileAsync('tmux', ['new-session', '-d', ...args], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
}

/** Lists all tmux session names (empty when tmux server is not running). */
export async function tmuxListSessionNames(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#S'], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((name) => name.length > 0);
  } catch {
    return [];
  }
}
