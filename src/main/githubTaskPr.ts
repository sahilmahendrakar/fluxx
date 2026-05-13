import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RepoConfig, TaskGithubPr, TaskPrErrorCode } from '../types';
import { parseGithubOwnerRepoFromPrUrl, parseGithubOwnerRepoFromRemote, parseGhPrViewJsonStdout } from '../githubPrMetadata';
import { resolveRepoForBranchDiscovery } from '../repoIdentity';
import { branchForTaskId } from '../taskBranch';
import { normalizeGitBranchShortName } from '../taskBranches';

const execFile = promisify(execFileCallback);

export type TaskPrError = { ok: false; code: TaskPrErrorCode; message: string };

export type TaskPrOk = {
  ok: true;
  githubPr: TaskGithubPr;
};

/** Successful PR create, including whether the base branch had to be published to origin first. */
export type TaskPrCreateOk = TaskPrOk & { pushedBaseBranch: boolean };

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

/** Arguments for `gh pr create` (excluding leading `gh`), for tests and tooling. */
export function buildGhPrCreateArgs(input: {
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
}): string[] {
  return [
    'pr',
    'create',
    '--title',
    input.title,
    '--body',
    input.body,
    '--base',
    input.baseBranch,
    '--head',
    input.headBranch,
  ];
}

export function extractPrUrlFromGhOutput(output: string): string | null {
  const match = output.match(/https?:\/\/github\.com\/[^\s"'<>]+\/pull\/\d+/i);
  return match?.[0] ?? null;
}

/** True when `origin` already advertises `refs/heads/<branchShort>`. */
export async function originHasHeadBranch(
  gitRootPath: string,
  branchShort: string,
): Promise<boolean> {
  const name = normalizeGitBranchShortName(branchShort);
  if (!name) return false;
  try {
    const { stdout } = await git(['ls-remote', '--heads', 'origin', name], gitRootPath);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function localHeadBranchExists(gitRootPath: string, branchShort: string): Promise<boolean> {
  const name = normalizeGitBranchShortName(branchShort);
  if (!name) return false;
  try {
    await execFile('git', ['show-ref', '--verify', '--quiet', `refs/heads/${name}`], {
      cwd: gitRootPath,
    });
    return true;
  } catch {
    return false;
  }
}

export async function pushOriginHeadFromLocal(
  gitRootPath: string,
  branchShort: string,
): Promise<TaskPrError | null> {
  const name = normalizeGitBranchShortName(branchShort);
  if (!name) {
    return { ok: false, code: 'PR_CREATE_FAILED', message: 'Cannot push empty branch name' };
  }
  try {
    await execFile(
      'git',
      ['push', '-u', 'origin', `refs/heads/${name}:refs/heads/${name}`],
      { cwd: gitRootPath, maxBuffer: 10 * 1024 * 1024 },
    );
    return null;
  } catch (err: unknown) {
    return {
      ok: false,
      code: 'PR_BASE_BRANCH_PUSH_FAILED',
      message:
        stderrOf(err).trim() ||
        `Publishing branch "${name}" to origin failed (GitHub needs it as the pull request base).`,
    };
  }
}

/** Pure branch of `ensureRemotePrBaseBranch` (for tests): given presence flags, what would we do? */
export function classifyRemotePrBaseReadiness(args: {
  originHasBranch: boolean;
  localHasBranch: boolean;
}): 'remote_ok' | 'push_local' | 'missing_everywhere' {
  if (args.originHasBranch) return 'remote_ok';
  if (args.localHasBranch) return 'push_local';
  return 'missing_everywhere';
}

/**
 * Ensures the PR base branch exists on `origin` before `gh pr create`.
 * When it exists locally but not on the remote, pushes `refs/heads/<branch>` to origin.
 */
export async function ensureRemotePrBaseBranch(
  gitRootPath: string,
  baseBranchShort: string,
): Promise<{ ok: true; pushedBaseBranch: boolean } | TaskPrError> {
  const base = normalizeGitBranchShortName(baseBranchShort);
  if (!base) {
    return {
      ok: false,
      code: 'PR_CREATE_FAILED',
      message: 'Pull request base branch resolved to an empty name.',
    };
  }
  const originHas = await originHasHeadBranch(gitRootPath, base);
  const localHas = await localHeadBranchExists(gitRootPath, base);
  const readiness = classifyRemotePrBaseReadiness({
    originHasBranch: originHas,
    localHasBranch: localHas,
  });
  if (readiness === 'remote_ok') {
    return { ok: true, pushedBaseBranch: false };
  }
  if (readiness === 'push_local') {
    const pushErr = await pushOriginHeadFromLocal(gitRootPath, base);
    if (pushErr) return pushErr;
    return { ok: true, pushedBaseBranch: true };
  }
  return {
    ok: false,
    code: 'PR_BASE_BRANCH_MISSING_REMOTE',
    message: `Base branch "${base}" is not on GitHub yet, and there is no local "${base}" branch to publish. Push that branch to origin from the main clone, or pick a base branch that already exists on the remote.`,
  };
}

/** Force persisted head/base to match the Flux work branch and the task-selected PR base. */
export function mergeTaskPrPersistFields(
  parsed: TaskGithubPr,
  headBranch: string,
  baseBranch: string,
): TaskGithubPr {
  const b = normalizeGitBranchShortName(baseBranch);
  return {
    ...parsed,
    headBranch,
    baseBranch: b || parsed.baseBranch,
  };
}

/** Compares previously stored PR refs with GitHub's current view (refresh diagnostics). */
export function prMetadataRefMismatchWarning(
  stored: TaskGithubPr | undefined,
  live: TaskGithubPr,
): string | undefined {
  if (!stored) return undefined;
  const parts: string[] = [];
  if (stored.headBranch && live.headBranch && stored.headBranch !== live.headBranch) {
    parts.push(
      `GitHub now reports head branch "${live.headBranch}" (Flux had "${stored.headBranch}").`,
    );
  }
  if (stored.baseBranch && live.baseBranch && stored.baseBranch !== live.baseBranch) {
    parts.push(
      `GitHub now reports base branch "${live.baseBranch}" (Flux had "${stored.baseBranch}").`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

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

function noOpenPullRequest(message = 'No open pull request found for this task worktree'): TaskPrError {
  return { ok: false, code: 'NO_OPEN_PR', message };
}

export async function ghPrViewCurrentBranchOpen(worktreePath: string): Promise<TaskPrOk | TaskPrError> {
  const pre = await assertGhAvailable(worktreePath);
  if (pre) return pre;

  const viewed = await gh(['pr', 'view', '--json', PR_VIEW_FIELDS], worktreePath);
  if (viewed.ok) {
    const parsed = parseGhPrViewJsonStdout(viewed.stdout);
    if (parsed?.state === 'open') {
      return { ok: true, githubPr: parsed };
    }
  } else if (viewed.notFound) {
    return { ok: false, code: 'GH_NOT_INSTALLED', message: viewed.message };
  }

  const branchResult = await readCurrentBranch(worktreePath);
  if (typeof branchResult !== 'string') {
    return noOpenPullRequest(branchResult.message);
  }

  const listed = await gh(
    [
      'pr',
      'list',
      '--state',
      'open',
      '--head',
      branchResult,
      '--limit',
      '1',
      '--json',
      PR_VIEW_FIELDS,
    ],
    worktreePath,
  );
  if (!listed.ok) {
    if (listed.notFound) {
      return { ok: false, code: 'GH_NOT_INSTALLED', message: listed.message };
    }
    return { ok: false, code: 'PR_VIEW_FAILED', message: listed.stderr || listed.message };
  }

  const parsed = parseGhPrViewJsonStdout(listed.stdout);
  if (parsed?.state === 'open') {
    return { ok: true, githubPr: parsed };
  }
  return noOpenPullRequest();
}

/**
 * Resolves cwd for `gh` (prefer the task worktree when present) and the repo root
 * used to read `origin` / validate PR URLs (`multi-repo2`).
 */
export async function resolveGithubPrGitOperationPaths(params: {
  repos: RepoConfig[];
  taskRepoId: string | undefined;
  worktreePath: string | null;
}): Promise<
  | { ok: true; ghCwd: string; gitRootPath: string; repo: RepoConfig }
  | TaskPrError
> {
  if (!params.repos.length) {
    return {
      ok: false,
      code: 'NO_PROJECT',
      message: 'No git repositories are configured for this Flux project.',
    };
  }
  const repoCfg = resolveRepoForBranchDiscovery(params.repos, params.taskRepoId);
  if (!repoCfg) {
    return {
      ok: false,
      code: 'NO_PROJECT',
      message:
        'This task targets a repository that is not configured in this project. Check Project Settings or the task repository field.',
    };
  }
  const gitRootPath = path.resolve(repoCfg.rootPath);
  let ghCwd = gitRootPath;
  const wt = params.worktreePath?.trim();
  if (wt) {
    try {
      const st = await fs.stat(wt);
      if (st.isDirectory()) ghCwd = wt;
    } catch {
      /* use repo root */
    }
  }
  return { ok: true, ghCwd, gitRootPath, repo: repoCfg };
}

/** When both URLs parse as github.com owner/repo slugs, rejects PRs that are not from this clone's origin. */
export function validateGithubPrMatchesTaskRemote(prUrl: string, originRemoteUrl: string): TaskPrError | null {
  const prSlug = parseGithubOwnerRepoFromPrUrl(prUrl);
  const originSlug = parseGithubOwnerRepoFromRemote(originRemoteUrl);
  if (!prSlug || !originSlug) return null;
  if (prSlug.owner === originSlug.owner && prSlug.repo === originSlug.repo) return null;
  return {
    ok: false,
    code: 'PR_REPO_MISMATCH',
    message: `This pull request is on GitHub at ${prSlug.owner}/${prSlug.repo}, but this task's clone uses origin ${originSlug.owner}/${originSlug.repo}.`,
  };
}

export async function createPullRequestForTaskWorktree(params: {
  worktreePath: string;
  gitRootPath: string;
  taskId: string;
  title: string;
  body: string;
  /** Normalized short branch name: task source branch, else project default. */
  baseBranch: string;
}): Promise<TaskPrCreateOk | TaskPrError> {
  const { worktreePath, gitRootPath, taskId, title, body, baseBranch } = params;
  const prBase = normalizeGitBranchShortName(baseBranch);
  if (!prBase) {
    return {
      ok: false,
      code: 'PR_CREATE_FAILED',
      message: 'Pull request base branch resolved to an empty name.',
    };
  }

  const pre = await assertGhAvailable(worktreePath);
  if (pre) return pre;

  const remote = await readOriginRemote(gitRootPath);
  if (!remote.ok) return remote;

  const branchResult = await readCurrentBranch(worktreePath);
  if (typeof branchResult !== 'string') return branchResult;

  const branchCheck = expectTaskBranch(taskId, branchResult);
  if (branchCheck) return branchCheck;

  const baseReady = await ensureRemotePrBaseBranch(gitRootPath, prBase);
  if (!baseReady.ok) return baseReady;
  const pushedBaseBranch = baseReady.pushedBaseBranch;

  const pushErr = await gitPushHead(worktreePath);
  if (pushErr) return pushErr;

  const existing = await gh(['pr', 'view', '--json', PR_VIEW_FIELDS], worktreePath);
  if (existing.ok) {
    const parsedExisting = parseGhPrViewJsonStdout(existing.stdout);
    if (parsedExisting?.state === 'open') {
      return {
        ok: true,
        pushedBaseBranch,
        githubPr: mergeTaskPrPersistFields(parsedExisting, branchResult, prBase),
      };
    }
  }

  const createArgs = buildGhPrCreateArgs({
    title,
    body,
    baseBranch: prBase,
    headBranch: branchResult,
  });
  const created = await gh(createArgs, worktreePath);
  if (!created.ok) {
    const msg = created.stderr || created.message;
    if (created.notFound) {
      return { ok: false, code: 'GH_NOT_INSTALLED', message: created.message };
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

  const url = extractPrUrlFromGhOutput(`${created.stdout}\n${created.stderr}`);
  if (!url) {
    return {
      ok: false,
      code: 'PR_CREATE_FAILED',
      message: created.stdout || created.stderr || 'gh pr create produced no URL',
    };
  }

  const viewed = await gh(['pr', 'view', url, '--json', PR_VIEW_FIELDS], worktreePath);
  if (viewed.ok) {
    const parsed = parseGhPrViewJsonStdout(viewed.stdout);
    if (parsed) {
      return {
        ok: true,
        pushedBaseBranch,
        githubPr: mergeTaskPrPersistFields(parsed, branchResult, prBase),
      };
    }
  }

  return {
    ok: true,
    pushedBaseBranch,
    githubPr: mergeTaskPrPersistFields({ url }, branchResult, prBase),
  };
}
