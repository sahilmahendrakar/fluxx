import { execFile as execFileCallback, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { shell } from 'electron';
import type { OpenWorkspaceTarget, Session } from '../types';
import { discoverMacEditor } from './discoverMacEditor';
import { worktreePathSegmentsForFluxxBranch } from './fluxxTaskWorkBranchNaming';

const execFile = promisify(execFileCallback);

/** Default install locations tried before PATH / discovery (macOS). */
const MAC_CURSOR_CLI = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
const MAC_VSCODE_CLI =
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';

/** If a PATH shim exits immediately, treat it as failure and try discovery. */
const EDITOR_CLI_QUICK_EXIT_MS = 400;

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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
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
      env: process.env,
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

/**
 * Like {@link spawnDetached}, but fails when the child exits non-zero within
 * {@link EDITOR_CLI_QUICK_EXIT_MS} (catches ~/.local/bin shims that spawn then exit).
 */
function spawnEditorCli(
  command: string,
  args: string[],
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
      env: process.env,
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
      const timer = setTimeout(() => {
        if (!settled) finish({ ok: true });
      }, EDITOR_CLI_QUICK_EXIT_MS);
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (settled) return;
        if (code === 0 || code === null) {
          finish({ ok: true });
        } else {
          finish({ error: `Editor CLI exited with code ${code}` });
        }
      });
    });
  });
}

async function spawnFirstEditorCli(
  commands: string[],
  args: string[],
): Promise<{ ok: true } | { error: string }> {
  let lastError = 'Command not found';
  for (const command of commands) {
    const spawnFn = path.isAbsolute(command) ? spawnDetached : spawnEditorCli;
    const r = await spawnFn(command, args);
    if ('ok' in r) return r;
    lastError = r.error;
  }
  return { error: lastError };
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

async function openMacApp(appName: string, absPath: string): Promise<{ ok: true } | { error: string }> {
  try {
    await execFile('open', ['-a', appName, absPath]);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}

async function openMacEditorDiscovered(
  kind: 'cursor' | 'vscode',
  absPath: string,
): Promise<{ ok: true } | { error: string }> {
  const install = await discoverMacEditor(kind);
  const label = kind === 'cursor' ? 'Cursor' : 'VS Code';
  if (!install) {
    return { error: `${label} isn't installed.` };
  }

  const cli = await spawnDetached(install.cliPath, [absPath]);
  if ('ok' in cli) return cli;

  const app = await openMacApp(install.openAppName, absPath);
  if ('ok' in app) return app;

  return {
    error: `Couldn't open ${label}. Use File → Open Folder in ${label}.`,
  };
}

/** Original macOS open sequence: default .app CLI → PATH → `open -a`. */
async function openCursorLegacyDarwin(
  absPath: string,
): Promise<{ ok: true } | { error: string }> {
  const commands = ['cursor'];
  if (await pathExists(MAC_CURSOR_CLI)) {
    commands.unshift(MAC_CURSOR_CLI);
  }
  const cli = await spawnFirstEditorCli(commands, [absPath]);
  if ('ok' in cli) return cli;
  return openMacApp('Cursor', absPath);
}

async function openVscodeLegacyDarwin(
  absPath: string,
): Promise<{ ok: true } | { error: string }> {
  const commands = ['code'];
  if (await pathExists(MAC_VSCODE_CLI)) {
    commands.unshift(MAC_VSCODE_CLI);
  }
  const cli = await spawnFirstEditorCli(commands, [absPath]);
  if ('ok' in cli) return cli;
  return openMacApp('Visual Studio Code', absPath);
}

async function openVscode(absPath: string): Promise<{ ok: true } | { error: string }> {
  if (process.platform === 'darwin') {
    const legacy = await openVscodeLegacyDarwin(absPath);
    if ('ok' in legacy) return legacy;
    return openMacEditorDiscovered('vscode', absPath);
  }
  const r = await spawnEditorCli('code', [absPath]);
  if ('ok' in r) return r;
  return {
    error: "VS Code isn't installed, or the `code` command isn't on your PATH.",
  };
}

async function openCursor(absPath: string): Promise<{ ok: true } | { error: string }> {
  if (process.platform === 'darwin') {
    const legacy = await openCursorLegacyDarwin(absPath);
    if ('ok' in legacy) return legacy;
    return openMacEditorDiscovered('cursor', absPath);
  }
  const cli = await spawnEditorCli('cursor', [absPath]);
  if ('ok' in cli) return cli;
  return {
    error: "Cursor isn't installed, or the `cursor` command isn't on your PATH.",
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
 * Picks the best daemon session row for workspace resolution when multiple exist.
 * Prefer {@link Session.repoId} matching `repoId` when provided.
 */
export function pickSessionForTaskWorktree(
  sessions: readonly Session[],
  taskId: string,
  repoId?: string | null,
): Session | undefined {
  const tid = taskId.trim();
  const rid = repoId?.trim();
  const candidates = sessions.filter((s) => s.taskId === tid && Boolean(s.worktreePath?.trim()));
  if (candidates.length === 0) return undefined;
  if (!rid) return candidates[0];
  const exact = candidates.find((s) => s.repoId?.trim() === rid);
  if (exact) return exact;
  const legacyNoRepo = candidates.find((s) => !s.repoId?.trim());
  return legacyNoRepo ?? candidates[0];
}

/**
 * Resolves a local filesystem path for a task worktree:
 * 1. Active daemon session worktree (prefer matching {@link Session.repoId} when `repoId` is set),
 * 2. When `fluxxWorkBranch` is set and `repoId` is set: `worktrees/{repoId}/<branch-path-segments>`,
 * 3. Repo-scoped folder under `worktrees/{repoId}/{taskId}` when `repoId` is set (multi-repo2),
 * 4. Legacy flat folder `worktrees/{taskId}`,
 * 5. First existing nested folder `worktrees/…/{taskId}` when repo id is unset (nested scan).
 */
export async function resolveTaskWorktreePath(
  taskId: string,
  listSessions: () => Promise<Session[]>,
  projectDir: string,
  repoId?: string | null,
  fluxxWorkBranch?: string | null,
): Promise<string | null> {
  if (!taskId.trim()) return null;
  try {
    const sessions = await listSessions();
    const match = pickSessionForTaskWorktree(sessions, taskId, repoId);
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

  const rid = repoId?.trim();
  const fw = fluxxWorkBranch?.trim();
  if (rid && fw) {
    const fluxScoped = path.join(
      projectDir,
      'worktrees',
      rid,
      ...worktreePathSegmentsForFluxxBranch(fw),
    );
    try {
      const st = await fs.stat(fluxScoped);
      if (st.isDirectory()) return fluxScoped;
    } catch {
      /* fall through */
    }
  }

  if (rid) {
    const repoScoped = path.join(projectDir, 'worktrees', rid, taskId);
    try {
      const st = await fs.stat(repoScoped);
      if (st.isDirectory()) return repoScoped;
    } catch {
      /* fall through */
    }
  }

  const legacyFlat = path.join(projectDir, 'worktrees', taskId);
  try {
    const st = await fs.stat(legacyFlat);
    if (st.isDirectory()) return legacyFlat;
  } catch {
    /* fall through */
  }

  if (!rid && fw) {
    const worktreesRootForFlux = path.join(projectDir, 'worktrees');
    try {
      const names = await fs.readdir(worktreesRootForFlux);
      for (const name of names) {
        if (!name.trim()) continue;
        const fluxNested = path.join(
          worktreesRootForFlux,
          name,
          ...worktreePathSegmentsForFluxxBranch(fw),
        );
        try {
          const st = await fs.stat(fluxNested);
          if (st.isDirectory()) return fluxNested;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (rid) {
    return null;
  }

  const worktreesRoot = path.join(projectDir, 'worktrees');
  try {
    const names = await fs.readdir(worktreesRoot);
    for (const name of names) {
      if (!name.trim() || name === taskId) continue;
      const nested = path.join(worktreesRoot, name, taskId);
      try {
        const st = await fs.stat(nested);
        if (st.isDirectory()) return nested;
      } catch {
        /* ignore */
      }
    }
  } catch {
    return null;
  }
  return null;
}
