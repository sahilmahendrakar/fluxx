import type { RepoConfig, SessionStartResult, Task } from '../types';
import { isWorktreeCreateError } from './worktreeCreateError';
import type { WorktreeService } from './WorktreeService';
import type { WorktreeSourceBranchOptions } from './WorktreeService';
import {
  createDirectFolderWorkspace,
  type TaskWorkspaceDescriptor,
} from './DirectFolderWorkspaceProvider';

export type TaskWorkspaceAtSessionStartParams = {
  gitEnabled: boolean;
  task: Pick<Task, 'id' | 'title' | 'fluxxWorkBranch'>;
  repoCfg: RepoConfig;
  worktreeService: WorktreeService;
  sourceOpts: WorktreeSourceBranchOptions;
};

export type TaskWorkspaceAtSessionStartResult =
  | { ok: true; descriptor: TaskWorkspaceDescriptor; repoCfg: RepoConfig }
  | { ok: false; result: SessionStartResult };

/**
 * Selects git (worktree) vs direct (folder) workspace provisioning once per session start.
 */
export async function createTaskWorkspaceAtSessionStart(
  params: TaskWorkspaceAtSessionStartParams,
): Promise<TaskWorkspaceAtSessionStartResult> {
  const { gitEnabled, task, repoCfg, worktreeService, sourceOpts } = params;

  if (!gitEnabled) {
    try {
      const descriptor = await createDirectFolderWorkspace(repoCfg);
      return { ok: true, descriptor, repoCfg };
    } catch (err: unknown) {
      if (isWorktreeCreateError(err)) {
        return { ok: false, result: { error: err.code, message: err.message } };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, result: { error: 'INTERNAL', message } };
    }
  }

  try {
    const layout = 'repo-scoped' as const;
    const created = await worktreeService.create({
      task: {
        id: task.id,
        title: task.title,
        fluxxWorkBranch: task.fluxxWorkBranch,
      },
      repo: {
        repoId: repoCfg.id,
        gitRootPath: repoCfg.rootPath,
        baseBranch: repoCfg.baseBranch,
        setupScript: repoCfg.setupScript,
        env: repoCfg.env,
      },
      source: sourceOpts,
      layout,
    });
    return {
      ok: true,
      repoCfg,
      descriptor: {
        cwd: created.worktreePath,
        branch: created.branch,
        workspaceKind: 'git',
        repoId: repoCfg.id,
      },
    };
  } catch (err: unknown) {
    if (isWorktreeCreateError(err)) {
      return { ok: false, result: { error: err.code, message: err.message } };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, result: { error: 'WORKTREE_FAILED', message } };
  }
}

/** Which workspace provider path applies for the current project setting. */
export function workspaceProviderKindForProject(gitEnabled: boolean): 'git' | 'direct' {
  return gitEnabled ? 'git' : 'direct';
}
