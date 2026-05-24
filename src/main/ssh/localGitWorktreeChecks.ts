import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fetchOriginBranchBestEffort } from '../repoGit';

const execFile = promisify(execFileCallback);

export type GitWorktreeDirtyState = {
  dirty: boolean;
  hasStaged: boolean;
  hasUnstaged: boolean;
  hasUntracked: boolean;
};

function gitErrText(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const s = (err as NodeJS.ErrnoException & { stderr?: Buffer | string }).stderr;
    const t = s != null ? String(s).trim() : '';
    if (t) return t;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function parseGitStatusPorcelain(output: string): GitWorktreeDirtyState {
  let hasStaged = false;
  let hasUnstaged = false;
  let hasUntracked = false;
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const indexStatus = line.length > 0 ? line[0] : ' ';
    const workTreeStatus = line.length > 1 ? line[1] : ' ';
    if (indexStatus === '?' && workTreeStatus === '?') {
      hasUntracked = true;
      continue;
    }
    if (indexStatus !== ' ' && indexStatus !== '?') hasStaged = true;
    if (workTreeStatus !== ' ' && workTreeStatus !== '?') hasUnstaged = true;
  }
  return {
    dirty: hasStaged || hasUnstaged || hasUntracked,
    hasStaged,
    hasUnstaged,
    hasUntracked,
  };
}

export async function isGitWorktreeDirty(worktreePath: string): Promise<GitWorktreeDirtyState> {
  const cwd = worktreePath?.trim();
  if (!cwd) {
    return { dirty: false, hasStaged: false, hasUnstaged: false, hasUntracked: false };
  }
  try {
    const { stdout } = await execFile('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
    });
    return parseGitStatusPorcelain(stdout);
  } catch {
    return { dirty: false, hasStaged: false, hasUnstaged: false, hasUntracked: false };
  }
}

export type BranchTrackingState = {
  localSha: string | null;
  originSha: string | null;
  ahead: number;
  behind: number;
  diverged: boolean;
};

export async function readBranchTrackingState(
  gitRoot: string,
  branchShort: string,
): Promise<BranchTrackingState> {
  const cwd = path.resolve(gitRoot);
  const branch = branchShort.trim();
  let localSha: string | null = null;
  let originSha: string | null = null;
  try {
    const { stdout } = await execFile(
      'git',
      ['rev-parse', '--verify', `refs/heads/${branch}`],
      { cwd, encoding: 'utf8' },
    );
    localSha = stdout.trim() || null;
  } catch {
    localSha = null;
  }
  try {
    const { stdout } = await execFile(
      'git',
      ['rev-parse', '--verify', `refs/remotes/origin/${branch}`],
      { cwd, encoding: 'utf8' },
    );
    originSha = stdout.trim() || null;
  } catch {
    originSha = null;
  }

  if (!localSha || !originSha) {
    return { localSha, originSha, ahead: 0, behind: 0, diverged: false };
  }
  if (localSha === originSha) {
    return { localSha, originSha, ahead: 0, behind: 0, diverged: false };
  }

  try {
    const { stdout } = await execFile(
      'git',
      ['rev-list', '--left-right', '--count', `origin/${branch}...${branch}`],
      { cwd, encoding: 'utf8' },
    );
    const parts = stdout.trim().split(/\s+/);
    const behind = Number.parseInt(parts[0] ?? '0', 10) || 0;
    const ahead = Number.parseInt(parts[1] ?? '0', 10) || 0;
    return {
      localSha,
      originSha,
      ahead,
      behind,
      diverged: ahead > 0 && behind > 0,
    };
  } catch {
    return { localSha, originSha, ahead: 0, behind: 0, diverged: localSha !== originSha };
  }
}

export async function fetchOriginBranch(gitRoot: string, branchShort: string): Promise<void> {
  await fetchOriginBranchBestEffort(path.resolve(gitRoot), branchShort.trim());
}

export async function ensureLocalBranchFromOrigin(
  gitRoot: string,
  branchShort: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const cwd = path.resolve(gitRoot);
  const branch = branchShort.trim();
  try {
    await execFile('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd });
    return { ok: true };
  } catch {
    /* create below */
  }
  try {
    await execFile(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`],
      { cwd },
    );
  } catch {
    return {
      ok: false,
      message: `origin/${branch} is not available after fetch. Push the remote branch first.`,
    };
  }
  try {
    await execFile('git', ['branch', branch, `origin/${branch}`], { cwd });
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, message: gitErrText(err) || `Could not create local branch ${branch}` };
  }
}

export async function fastForwardWorktreeToOrigin(
  worktreePath: string,
  branchShort: string,
): Promise<{ ok: true; headCommit: string } | { ok: false; message: string }> {
  const cwd = worktreePath.trim();
  const branch = branchShort.trim();
  if (!cwd || !branch) {
    return { ok: false, message: 'Missing worktree path or branch for fast-forward.' };
  }
  try {
    await execFile('git', ['merge', '--ff-only', `origin/${branch}`], { cwd });
  } catch (err: unknown) {
    return {
      ok: false,
      message:
        gitErrText(err) ||
        `Could not fast-forward ${branch} to origin/${branch}. Resolve divergence locally first.`,
    };
  }
  try {
    const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
    return { ok: true, headCommit: stdout.trim() };
  } catch (err: unknown) {
    return { ok: false, message: gitErrText(err) };
  }
}

export async function pathExistsAsDirectory(absPath: string): Promise<boolean> {
  try {
    const st = await fs.stat(absPath);
    return st.isDirectory();
  } catch {
    return false;
  }
}
