import { execFile as execFileCallback, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import type { RepoConfig } from '../types';

const execFile = promisify(execFileCallback);

function sanitiseTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9]/g, '-');
}

function branchForTaskId(taskId: string): string {
  return `flux/task-${sanitiseTaskId(taskId)}`;
}

/**
 * Async getter that returns the per-repo config for the given rootPath, or
 * null if none is configured yet. Injected so the service stays decoupled
 * from ProjectStore (which it shares a circular boot relationship with).
 */
export type RepoConfigGetter = (rootPath: string) => Promise<RepoConfig | null>;

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

  async create(taskId: string): Promise<{ worktreePath: string; branch: string }> {
    if (!this.rootPath) {
      throw new Error('WorktreeService: no project root path set');
    }
    if (!this.projectDir) {
      throw new Error('WorktreeService: no project directory set');
    }

    const branch = branchForTaskId(taskId);
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

    try {
      if (branchExists) {
        await execFile('git', ['worktree', 'add', worktreePath, branch], {
          cwd: this.rootPath,
        });
      } else {
        const baseRef = await this.resolveBaseRef(repoConfig?.baseBranch);
        const addArgs = baseRef
          ? ['worktree', 'add', worktreePath, '-b', branch, baseRef]
          : ['worktree', 'add', worktreePath, '-b', branch];
        await execFile('git', addArgs, { cwd: this.rootPath });
      }
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'stderr' in err
          ? String((err as NodeJS.ErrnoException & { stderr?: Buffer | string }).stderr ?? '')
          : err instanceof Error
            ? err.message
            : String(err);
      throw new Error(message.trim() || 'git worktree add failed');
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
    const branch = branchForTaskId(taskId);

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
   * Resolve the base ref for a brand-new task branch. When `configuredBranch`
   * is provided (from the project's RepoConfig), it takes precedence;
   * otherwise we fall back to detecting the remote default via `origin/HEAD`.
   * Either way we fetch the chosen branch best-effort so the worktree starts
   * from up-to-date code and return `origin/<branch>`. Returns null when
   * there is no usable remote ref so the caller falls back to local HEAD.
   */
  private async resolveBaseRef(configuredBranch?: string): Promise<string | null> {
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

    try {
      await execFile('git', ['fetch', 'origin', defaultBranch], {
        cwd: this.rootPath,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
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
      return `origin/${defaultBranch}`;
    } catch {
      return null;
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
