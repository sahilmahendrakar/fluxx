import { execFile as execFileCallback, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { shell } from 'electron';
import type { OpenWorkspaceTarget, Session } from '../types';

const execFile = promisify(execFileCallback);

const OPEN_TARGETS = new Set<OpenWorkspaceTarget>([
  'cursor',
  'vscode',
  'terminal',
  'file-manager',
]);

function isOpenWorkspaceTarget(v: unknown): v is OpenWorkspaceTarget {
  return typeof v === 'string' && OPEN_TARGETS.has(v as OpenWorkspaceTarget);
}

async function resolveExistingDir(rawPath: string): Promise<{ ok: true; absPath: string } | { error: string }> {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return { error: 'Path is empty' };
  }
  const absPath = path.resolve(trimmed);
  try {
    const st = await fs.stat(absPath);
    if (!st.isDirectory()) {
      return { error: 'Path is not a directory' };
    }
    return { ok: true, absPath };
  } catch {
    return { error: 'Workspace folder does not exist or is not accessible' };
  }
}

function spawnDetached(
  command: string,
  args: string[],
  options?: { shell?: boolean },
): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: { ok: true } | { error: string }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: options?.shell ?? false,
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      finish({
        error:
          err.code === 'ENOENT'
            ? `Command not found: ${command}`
            : err.message || String(err),
      });
    });
    child.on('spawn', () => {
      child.unref();
      finish({ ok: true });
    });
  });
}

async function openFileManager(absPath: string): Promise<{ ok: true } | { error: string }> {
  const err = await shell.openPath(absPath);
  if (err) {
    return { error: err };
  }
  return { ok: true };
}

async function openTerminalAt(absPath: string): Promise<{ ok: true } | { error: string }> {
  const platform = process.platform;
  if (platform === 'darwin') {
    try {
      await execFile('open', ['-a', 'Terminal', absPath]);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Could not open Terminal: ${msg}` };
    }
  }
  if (platform === 'win32') {
    try {
      await execFile('wt.exe', ['-d', absPath], { windowsHide: true });
      return { ok: true };
    } catch {
      try {
        const escaped = absPath.replace(/"/g, '""');
        await execFile('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', `cd /d "${escaped}"`], {
          windowsHide: true,
        });
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `Could not open a terminal: ${msg}` };
      }
    }
  }
  const tryCommands: { bin: string; args: string[] }[] = [
    { bin: 'gnome-terminal', args: ['--working-directory', absPath] },
    { bin: 'konsole', args: ['--workdir', absPath] },
    { bin: 'xfce4-terminal', args: ['--working-directory', absPath] },
  ];
  for (const { bin, args } of tryCommands) {
    const r = await spawnDetached(bin, args);
    if ('ok' in r) return r;
  }
  return {
    error:
      'No supported terminal was found. Install gnome-terminal, konsole, or xfce4-terminal.',
  };
}

async function openVscode(absPath: string): Promise<{ ok: true } | { error: string }> {
  const r = await spawnDetached('code', [absPath]);
  if ('ok' in r) return r;
  return {
    error: `${r.error} Install VS Code and enable the \`code\` shell command (Command Palette: "Shell Command: Install 'code' command in PATH").`,
  };
}

async function openCursor(absPath: string): Promise<{ ok: true } | { error: string }> {
  const cli = await spawnDetached('cursor', [absPath]);
  if ('ok' in cli) return cli;
  if (process.platform === 'darwin') {
    try {
      await execFile('open', ['-a', 'Cursor', absPath]);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        error: `Could not open Cursor (${msg}). Install Cursor and add the \`cursor\` CLI to PATH, or install the Cursor app.`,
      };
    }
  }
  return {
    error: `${cli.error} Install Cursor and add the \`cursor\` CLI to PATH.`,
  };
}

/**
 * Opens a validated workspace directory in the requested external target.
 */
export async function openWorkspacePath(
  rawPath: unknown,
  rawTarget: unknown,
): Promise<{ ok: true } | { error: string }> {
  if (typeof rawPath !== 'string') {
    return { error: 'Invalid path' };
  }
  if (!isOpenWorkspaceTarget(rawTarget)) {
    return { error: 'Invalid open target' };
  }
  const dir = await resolveExistingDir(rawPath);
  if ('error' in dir) return dir;
  const { absPath } = dir;

  switch (rawTarget) {
    case 'file-manager':
      return openFileManager(absPath);
    case 'terminal':
      return openTerminalAt(absPath);
    case 'vscode':
      return openVscode(absPath);
    case 'cursor':
      return openCursor(absPath);
  }
}

/**
 * Resolves a local filesystem path for a task worktree: active daemon session first,
 * then `<projectDir>/worktrees/<taskId>` if that directory exists.
 */
export async function resolveTaskWorktreePath(
  taskId: string,
  listSessions: () => Promise<Session[]>,
  projectDir: string,
): Promise<string | null> {
  if (!taskId) return null;
  try {
    const sessions = await listSessions();
    const match = sessions.find((s) => s.taskId === taskId && s.worktreePath);
    if (match?.worktreePath) {
      try {
        const st = await fs.stat(match.worktreePath);
        if (st.isDirectory()) return match.worktreePath;
      } catch {
        /* fall through */
      }
    }
  } catch {
    /* daemon unavailable — try disk only */
  }
  if (!projectDir) return null;
  const fallback = path.join(projectDir, 'worktrees', taskId);
  try {
    const st = await fs.stat(fallback);
    if (st.isDirectory()) return fallback;
  } catch {
    return null;
  }
  return null;
}
