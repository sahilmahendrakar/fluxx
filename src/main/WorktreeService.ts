import { execFile as execFileCallback, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import type { RepoConfig } from '../types';
import {
  fetchOriginBranchBestEffort,
  resolveLocalOrOriginRefWithAmbiguity,
} from './repoGit';
import { WorktreeCreateError } from './worktreeCreateError';
import { fluxTaskWorkBranchName } from './fluxTaskBranch';

const execFile = promisify(execFileCallback);

function gitErrText(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const s = (err as NodeJS.ErrnoException & { stderr?: Buffer | string }).stderr;
    const t = s != null ? String(s).trim() : '';
    if (t) return t;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Async getter that returns the per-repo config for the given rootPath, or
 * null if none is configured yet. Injected so the service stays decoupled
 * from ProjectStore (which it shares a circular boot relationship with).
 */
export type RepoConfigGetter = (rootPath: string) => Promise<RepoConfig | null>;

/** Options for basing a new `flux/task-*` worktree on `Task.sourceBranch`. */
export type WorktreeSourceBranchOptions = {
  /** Normalized short branch name (task source / PR base intent). */
  sourceBranchShort: string;
  /** When the source ref is missing, create it from the project default via `resolveBaseRef`. */
  createSourceBranchIfMissing: boolean;
};

export class WorktreeService {
  private repoConfigGetter: RepoConfigGetter | null = null;

  constructor(
    private rootPath: string,
    private projectDir: string,
  ) {}

  setRootPath(nextPath: string): void {
    this.rootPath = nextPath;
  }

  setProjectDir(nextDir: string): void {
    this.projectDir = nextDir;
  }

  setRepoConfigGetter(getter: RepoConfigGetter | null): void {
    this.repoConfigGetter = getter;
  }

  getProjectDir(): string {
    return this.projectDir;
  }

  getRootPath(): string {
    return this.rootPath;
  }

  async create(
    taskId: string,
    sourceOpts: WorktreeSourceBranchOptions,
  ): Promise<{ worktreePath: string; branch: string }> {
    if (!this.rootPath) {
      throw new Error('WorktreeService: no project root path set');
    }
    if (!this.projectDir) {
      throw new Error('WorktreeService: no project directory set');
    }

    const branch = fluxTaskWorkBranchName(taskId);
    const worktreesRoot = path.join(this.projectDir, 'worktrees');
    await fs.mkdir(worktreesRoot, { recursive: true });
    const worktreePath = path.join(worktreesRoot, taskId);

    await this.reclaimStaleWorktree(worktreePath);

    let branchExists = false;
    try {
      await execFile('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
        cwd: this.rootPath,
      });
      branchExists = true;
    } catch {
      branchExists = false;
    }

    const repoConfig = this.repoConfigGetter
      ? await this.repoConfigGetter(this.rootPath).catch(() => null)
      : null;

    const sourceShort = sourceOpts.sourceBranchShort.trim();
    if (!sourceShort) {
      throw new WorktreeCreateError(
        'WORKTREE_REPO_INVALID_STATE',
        'Task source branch resolved to an empty name after normalization. Set a valid base branch on the task or in project settings.',
      );
    }

    await fetchOriginBranchBestEffort(this.rootPath, sourceShort);

    try {
      if (branchExists) {
        await execFile('git', ['worktree', 'add', worktreePath, branch], {
          cwd: this.rootPath,
        });
      } else {
        const resolved = await resolveLocalOrOriginRefWithAmbiguity(this.rootPath, sourceShort, {
          onDivergence: 'prefer-origin',
        });
        if (resolved.kind === 'ambiguous') {
          throw new WorktreeCreateError(
            'WORKTREE_SOURCE_BRANCH_AMBIGUOUS',
            `Branch '${sourceShort}' exists locally and as origin/${sourceShort}, but they point to different commits (${resolved.localSha.slice(0, 7)} vs ${resolved.remoteSha.slice(0, 7)}). Merge or reset one side, or rename, before starting this task.`,
            sourceShort,
          );
        }
        let startRef = resolved.kind === 'ok' ? resolved.ref : null;
        if (!startRef && sourceOpts.createSourceBranchIfMissing) {
          const base = await this.resolveBaseRef(repoConfig?.baseBranch);
          if (!base.ref) {
            const hint = base.fetchError
              ? ` Last fetch attempt failed: ${base.fetchError}`
              : '';
            const code =
              base.fetchError != null ? 'WORKTREE_FETCH_FAILED' : 'WORKTREE_BASE_BRANCH_UNAVAILABLE';
            throw new WorktreeCreateError(
              code,
              `Cannot create missing source branch '${sourceShort}': project default branch '${base.defaultBranchShort}' is not available (check remotes and RepoConfig.baseBranch).${hint}`,
              sourceShort,
            );
          }
          try {
            await execFile('git', ['branch', sourceShort, base.ref], {
              cwd: this.rootPath,
            });
          } catch (branchErr: unknown) {
            const detail = gitErrText(branchErr);
            throw new WorktreeCreateError(
              'WORKTREE_SOURCE_BRANCH_CREATE_FAILED',
              `Could not create local source branch '${sourceShort}' from project default: ${detail}`,
              sourceShort,
            );
          }
          const again = await resolveLocalOrOriginRefWithAmbiguity(this.rootPath, sourceShort, {
            onDivergence: 'prefer-local',
          });
          if (again.kind === 'ambiguous') {
            throw new WorktreeCreateError(
              'WORKTREE_SOURCE_BRANCH_AMBIGUOUS',
              `Branch '${sourceShort}' is ambiguous after creation (local vs origin/${sourceShort} differ).`,
              sourceShort,
            );
          }
          startRef = again.kind === 'ok' ? again.ref : null;
        }
        if (!startRef) {
          const msg = sourceOpts.createSourceBranchIfMissing
            ? `Could not resolve or create source branch '${sourceShort}' after setup.`
            : `Source branch '${sourceShort}' does not exist locally or as origin/${sourceShort}, and creating it is disabled for this task.`;
          throw new WorktreeCreateError('WORKTREE_SOURCE_BRANCH_MISSING', msg, sourceShort);
        }
        await execFile(
          'git',
          ['worktree', 'add', worktreePath, '-b', branch, startRef],
          { cwd: this.rootPath },
        );
      }
    } catch (err: unknown) {
      if (err instanceof WorktreeCreateError) throw err;
      const message = gitErrText(err);
      throw new WorktreeCreateError(
        'WORKTREE_FAILED',
        message.trim() || 'git worktree add failed',
        sourceShort,
      );
    }

    if (repoConfig?.env && repoConfig.env.length > 0) {
      try {
        await fs.writeFile(path.join(worktreePath, '.env'), repoConfig.env, 'utf8');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[WorktreeService.create] failed to write .env at ${worktreePath}: ${message}`,
        );
      }
    }

    if (repoConfig?.setupScript && repoConfig.setupScript.trim().length > 0) {
      await this.runSetupScript(worktreePath, repoConfig.setupScript);
    }

    return { worktreePath, branch };
  }

  /**
   * Runs the project's per-repo setup script inside the new worktree. Output
   * is appended to `<worktree>/.flux-setup.log` so users can inspect failures
   * without blocking task launch. Non-zero exits are warned about, not thrown.
   */
  private async runSetupScript(worktreePath: string, script: string): Promise<void> {
    const logPath = path.join(worktreePath, '.flux-setup.log');
    try {
      await fs.writeFile(
        logPath,
        `# flux setup script — ${new Date().toISOString()}\n`,
        'utf8',
      );
    } catch {
      // best-effort log header
    }
    await new Promise<void>((resolve) => {
      const child = spawn('bash', ['-lc', script], {
        cwd: worktreePath,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const append = (chunk: Buffer) => {
        fs.appendFile(logPath, chunk).catch(() => {
          /* best-effort */
        });
      };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      child.on('error', (err) => {
        console.warn(
          `[WorktreeService.create] setup script spawn error: ${err.message}`,
        );
        resolve();
      });
      child.on('exit', (code) => {
        if (code !== 0) {
          console.warn(
            `[WorktreeService.create] setup script exited with code ${code} (see ${logPath})`,
          );
        }
        resolve();
      });
    });
  }

  async remove(worktreePath: string): Promise<void> {
    if (!this.rootPath) {
      console.warn('[WorktreeService.remove] no root path set, skipping');
      return;
    }

    try {
      await fs.access(worktreePath);
    } catch {
      console.warn(
        `[WorktreeService.remove] worktree path does not exist, skipping: ${worktreePath}`,
      );
      return;
    }

    const taskId = path.basename(worktreePath);
    const branch = fluxTaskWorkBranchName(taskId);

    try {
      await execFile('git', ['worktree', 'remove', worktreePath, '--force'], {
        cwd: this.rootPath,
      });
    } catch (err: unknown) {
      const stderr =
        err && typeof err === 'object' && 'stderr' in err
          ? String((err as { stderr?: Buffer | string }).stderr ?? '')
          : '';
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[WorktreeService.remove] git worktree remove failed: ${worktreePath}`,
        stderr || message,
      );
    }

    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[WorktreeService.remove] fs.rm fallback failed: ${worktreePath}`,
        message,
      );
    }

    try {
      await execFile('git', ['worktree', 'prune'], { cwd: this.rootPath });
    } catch {
      // best-effort
    }

    try {
      await execFile('git', ['branch', '-D', branch], { cwd: this.rootPath });
    } catch (err: unknown) {
      const stderr =
        err && typeof err === 'object' && 'stderr' in err
          ? String((err as { stderr?: Buffer | string }).stderr ?? '')
          : '';
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[WorktreeService.remove] git branch -D failed for ${branch}:`, stderr || message);
    }
  }

  /**
   * Resolve the base ref for creating a missing task source branch. Prefers
   * `origin/<branch>` after a best-effort fetch, then a local `refs/heads`
   * branch matching the project default name.
   */
  private async resolveBaseRef(configuredBranch?: string): Promise<{
    ref: string | null;
    defaultBranchShort: string;
    fetchError?: string;
  }> {
    let defaultBranch = configuredBranch?.trim() || 'main';
    if (!configuredBranch) {
      try {
        const { stdout } = await execFile(
          'git',
          ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
          { cwd: this.rootPath, encoding: 'utf8' },
        );
        const ref = stdout.trim();
        if (ref.startsWith('origin/')) {
          defaultBranch = ref.slice('origin/'.length);
        }
      } catch {
        // origin/HEAD not set; fall through with 'main' as a best guess.
      }
    }

    let fetchError: string | undefined;
    try {
      await execFile('git', ['fetch', 'origin', defaultBranch], {
        cwd: this.rootPath,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      fetchError = message;
      console.warn(
        `[WorktreeService.create] git fetch origin ${defaultBranch} failed; using local ref`,
        message,
      );
    }

    try {
      await execFile(
        'git',
        ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${defaultBranch}`],
        { cwd: this.rootPath },
      );
      return { ref: `origin/${defaultBranch}`, defaultBranchShort: defaultBranch };
    } catch {
      /* fall through */
    }

    try {
      await execFile(
        'git',
        ['rev-parse', '--verify', '--quiet', `refs/heads/${defaultBranch}`],
        { cwd: this.rootPath },
      );
      return { ref: defaultBranch, defaultBranchShort: defaultBranch, fetchError };
    } catch {
      return { ref: null, defaultBranchShort: defaultBranch, fetchError };
    }
  }

  /**
   * If a previous session left a stale worktree at the target path (e.g. from a
   * hard crash where onExit cleanup never ran), reclaim it so `git worktree add`
   * can succeed. Clears both the on-disk directory and git's worktree metadata.
   */
  private async reclaimStaleWorktree(worktreePath: string): Promise<void> {
    let exists = false;
    try {
      await fs.access(worktreePath);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      try {
        await execFile('git', ['worktree', 'prune'], { cwd: this.rootPath });
      } catch {
        // best-effort
      }
      return;
    }

    console.warn(
      `[WorktreeService.create] reclaiming stale worktree: ${worktreePath}`,
    );

    try {
      await execFile('git', ['worktree', 'remove', worktreePath, '--force'], {
        cwd: this.rootPath,
      });
    } catch {
      // git may not know about the path; fall through to fs.rm
    }

    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to remove stale worktree at ${worktreePath}: ${message}`);
    }

    try {
      await execFile('git', ['worktree', 'prune'], { cwd: this.rootPath });
    } catch {
      // best-effort
    }
  }

  async listWorktrees(): Promise<string[]> {
    if (!this.rootPath) {
      return [];
    }
    const { stdout } = await execFile('git', ['worktree', 'list', '--porcelain'], {
      cwd: this.rootPath,
      encoding: 'utf8',
    });
    const paths: string[] = [];
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        paths.push(line.slice('worktree '.length));
      }
    }
    return paths;
  }
}
