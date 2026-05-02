import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { TaskGithubPr, TaskPrErrorCode } from '../types';
import { branchForTaskId } from '../taskBranch';
import { parseGhPrViewJsonStdout } from '../githubPrMetadata';

const execFile = promisify(execFileCallback);

export type TaskPrError = { ok: false; code: TaskPrErrorCode; message: string };

export type TaskPrOk = {
  ok: true;
  githubPr: TaskGithubPr;
};

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

function stderrOf(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const s = (err as { stderr?: Buffer | string }).stderr;
    if (Buffer.isBuffer(s)) return s.toString('utf8');
    if (typeof s === 'string') return s;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Accepts github.com over https, http, or git@ (gh needs a GitHub host). */
export function isGithubHostingRemote(remote: string): boolean {
  const t = remote.trim();
  if (!t) return false;
  if (/^git@github\.com:/i.test(t)) return true;
  if (/^ssh:\/\/git@github\.com\//i.test(t)) return true;
  try {
    const u = new URL(t);
    return u.hostname === 'github.com' && (u.protocol === 'https:' || u.protocol === 'http:');
  } catch {
    return false;
  }
}

async function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const r = await execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return { stdout: String(r.stdout).trimEnd(), stderr: String(r.stderr).trimEnd() };
}

type GhExecResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; notFound?: boolean; stderr: string; message: string };

async function gh(args: string[], cwd: string): Promise<GhExecResult> {
  try {
    const r = await execFile('gh', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return { ok: true, stdout: String(r.stdout).trimEnd(), stderr: String(r.stderr).trimEnd() };
  } catch (err: unknown) {
    if (errnoCode(err) === 'ENOENT') {
      return {
        ok: false,
        notFound: true,
        stderr: '',
        message: 'GitHub CLI (gh) is not installed or not on PATH',
      };
    }
    return {
      ok: false,
      stderr: stderrOf(err),
      message: stderrOf(err) || 'gh command failed',
    };
  }
}

export async function assertGhAvailable(worktreePath: string): Promise<TaskPrError | null> {
  const v = await gh(['version'], worktreePath);
  if (!v.ok) {
    if (v.notFound) {
      return { ok: false, code: 'GH_NOT_INSTALLED', message: v.message };
    }
    return { ok: false, code: 'GH_NOT_INSTALLED', message: v.message };
  }
  if (!v.stdout.includes('gh version')) {
    return { ok: false, code: 'GH_NOT_INSTALLED', message: 'GitHub CLI (gh) is not working' };
  }
  try {
    await execFile('gh', ['auth', 'status', '-h', 'github.com'], {
      cwd: worktreePath,
      maxBuffer: 1024 * 1024,
    });
  } catch (err: unknown) {
    if (errnoCode(err) === 'ENOENT') {
      return {
        ok: false,
        code: 'GH_NOT_INSTALLED',
        message: 'GitHub CLI (gh) is not installed or not on PATH',
      };
    }
    const msg = stderrOf(err);
    return {
      ok: false,
      code: 'GH_AUTH_FAILED',
      message: msg.trim() || 'Run `gh auth login` for github.com',
    };
  }
  return null;
}

export async function readOriginRemote(gitRootPath: string): Promise<
  { ok: true; url: string } | TaskPrError
> {
  try {
    const { stdout } = await git(['remote', 'get-url', 'origin'], gitRootPath);
    const url = stdout.trim();
    if (!url) {
      return { ok: false, code: 'NO_GITHUB_REMOTE', message: 'Git remote `origin` is not set' };
    }
    if (!isGithubHostingRemote(url)) {
      return {
        ok: false,
        code: 'NO_GITHUB_REMOTE',
        message: 'Remote `origin` must point to github.com for this workflow',
      };
    }
    return { ok: true, url };
  } catch (err: unknown) {
    const msg = stderrOf(err) || 'Could not read git remote origin';
    return {
      ok: false,
      code: 'NO_GITHUB_REMOTE',
      message: msg.includes('No such remote') ? 'Git remote `origin` is not set' : msg,
    };
  }
}

export async function readCurrentBranch(worktreePath: string): Promise<string | TaskPrError> {
  try {
    const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
    const b = stdout.trim();
    if (!b || b === 'HEAD') {
      return { ok: false, code: 'PR_CREATE_FAILED', message: 'Detached HEAD; cannot open a PR' };
    }
    return b;
  } catch (err: unknown) {
    return {
      ok: false,
      code: 'PR_CREATE_FAILED',
      message: stderrOf(err) || 'Could not read current branch',
    };
  }
}

export function expectTaskBranch(taskId: string, branch: string): TaskPrError | null {
  const expected = branchForTaskId(taskId);
  if (branch !== expected) {
    return {
      ok: false,
      code: 'PR_CREATE_FAILED',
      message: `Worktree branch is ${branch}; expected ${expected} for this task`,
    };
  }
  return null;
}

async function gitPushHead(worktreePath: string): Promise<TaskPrError | null> {
  try {
    await execFile('git', ['push', '-u', 'origin', 'HEAD'], {
      cwd: worktreePath,
      maxBuffer: 10 * 1024 * 1024,
    });
    return null;
  } catch (err: unknown) {
    const text = stderrOf(err).toLowerCase();
    const msg = stderrOf(err) || 'git push failed';
    if (
      text.includes('rejected') ||
      text.includes('no upstream') ||
      text.includes('failed to push') ||
      text.includes('could not read from remote')
    ) {
      return {
        ok: false,
        code: 'BRANCH_PUSH_FAILED',
        message: msg,
      };
    }
    return {
      ok: false,
      code: 'BRANCH_PUSH_FAILED',
      message: msg,
    };
  }
}

const PR_VIEW_FIELDS =
  'url,number,state,mergedAt,headRefName,baseRefName,createdAt,updatedAt';

export async function ghPrViewJson(
  worktreePath: string,
  prSelector: string,
): Promise<TaskPrOk | TaskPrError> {
  const pre = await assertGhAvailable(worktreePath);
  if (pre) return pre;

  const r = await gh(['pr', 'view', prSelector, '--json', PR_VIEW_FIELDS], worktreePath);
  if (!r.ok) {
    if (r.notFound) {
      return { ok: false, code: 'GH_NOT_INSTALLED', message: r.message };
    }
    return {
      ok: false,
      code: 'PR_VIEW_FAILED',
      message: r.stderr || r.message,
    };
  }
  const parsed = parseGhPrViewJsonStdout(r.stdout);
  if (!parsed) {
    return {
      ok: false,
      code: 'PR_VIEW_FAILED',
      message: 'Could not parse `gh pr view` JSON output',
    };
  }
  return { ok: true, githubPr: parsed };
}

export async function createPullRequestForTaskWorktree(params: {
  worktreePath: string;
  gitRootPath: string;
  taskId: string;
  title: string;
  body: string;
  baseBranch: string;
}): Promise<TaskPrOk | TaskPrError> {
  const { worktreePath, gitRootPath, taskId, title, body, baseBranch } = params;

  const pre = await assertGhAvailable(worktreePath);
  if (pre) return pre;

  const remote = await readOriginRemote(gitRootPath);
  if (!remote.ok) return remote;

  const branchResult = await readCurrentBranch(worktreePath);
  if (typeof branchResult !== 'string') return branchResult;

  const branchCheck = expectTaskBranch(taskId, branchResult);
  if (branchCheck) return branchCheck;

  const pushErr = await gitPushHead(worktreePath);
  if (pushErr) return pushErr;

  const jsonArgs = [
    'pr',
    'create',
    '--title',
    title,
    '--body',
    body,
    '--base',
    baseBranch,
    '--head',
    branchResult,
    '--json',
    PR_VIEW_FIELDS,
  ];
  const r = await gh(jsonArgs, worktreePath);
  if (!r.ok) {
    const fallback = await gh(
      ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch, '--head', branchResult],
      worktreePath,
    );
    if (!fallback.ok) {
      const msg = r.stderr || r.message || fallback.stderr || fallback.message;
      if (r.notFound || fallback.notFound) {
        return { ok: false, code: 'GH_NOT_INSTALLED', message: r.message || fallback.message };
      }
      const low = msg.toLowerCase();
      if (low.includes('authentication') || low.includes('401') || low.includes('denied')) {
        return { ok: false, code: 'GH_AUTH_FAILED', message: msg };
      }
      if (low.includes('not found') && low.includes('branch')) {
        return {
          ok: false,
          code: 'BRANCH_PUSH_FAILED',
          message: msg,
        };
      }
      return { ok: false, code: 'PR_CREATE_FAILED', message: msg };
    }
    const line = fallback.stdout.split('\n').find((l) => l.includes('http'));
    if (line) {
      const url = line.replace(/\s/g, '');
      return {
        ok: true,
        githubPr: { url, headBranch: branchResult, baseBranch },
      };
    }
    return {
      ok: false,
      code: 'PR_CREATE_FAILED',
      message: fallback.stdout || 'gh pr create produced no URL',
    };
  }

  const parsed = parseGhPrViewJsonStdout(r.stdout);
  if (!parsed) {
    return {
      ok: false,
      code: 'PR_CREATE_FAILED',
      message: 'gh pr create succeeded but JSON could not be parsed',
    };
  }
  return { ok: true, githubPr: parsed };
}
