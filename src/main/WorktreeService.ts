import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

function sanitiseTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9]/g, '-');
}

function branchForTaskId(taskId: string): string {
  return `flux/task-${sanitiseTaskId(taskId)}`;
}

export class WorktreeService {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  setRootPath(nextPath: string): void {
    this.rootPath = nextPath;
  }

  async create(taskId: string): Promise<{ worktreePath: string; branch: string }> {
    if (!this.rootPath) {
      throw new Error('WorktreeService: no project root path set');
    }

    const branch = branchForTaskId(taskId);
    const worktreesParent = path.join(this.rootPath, '..', '.flux-worktrees');
    await fs.mkdir(worktreesParent, { recursive: true });
    const worktreePath = path.join(worktreesParent, taskId);

    let branchExists = false;
    try {
      await execFile('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
        cwd: this.rootPath,
      });
      branchExists = true;
    } catch {
      branchExists = false;
    }

    try {
      if (branchExists) {
        await execFile('git', ['worktree', 'add', worktreePath, branch], {
          cwd: this.rootPath,
        });
      } else {
        await execFile('git', ['worktree', 'add', worktreePath, '-b', branch], {
          cwd: this.rootPath,
        });
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

    return { worktreePath, branch };
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
