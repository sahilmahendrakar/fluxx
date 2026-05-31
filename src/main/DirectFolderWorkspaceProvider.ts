import path from 'node:path';
import fs from 'node:fs/promises';
import type { RepoConfig, SessionWorkspaceKind } from '../types';
import { WorktreeCreateError } from './worktreeCreateError';

export type TaskWorkspaceDescriptor = {
  cwd: string;
  branch: string;
  workspaceKind: SessionWorkspaceKind;
  repoId: string;
};

/**
 * Gitless local workspace: run the agent in the repo/working folder with no worktree or branch.
 * Does not write `.env` or run setup scripts (see gitless plan decision #4).
 */
export async function createDirectFolderWorkspace(
  repoCfg: RepoConfig,
): Promise<TaskWorkspaceDescriptor> {
  const cwd = path.resolve(repoCfg.rootPath);
  try {
    await fs.access(cwd);
  } catch {
    throw new WorktreeCreateError(
      'WORKTREE_REPO_PATH_MISSING',
      `The working folder does not exist: ${cwd}`,
    );
  }

  return {
    cwd,
    branch: '',
    workspaceKind: 'direct',
    repoId: repoCfg.id,
  };
}

export function isDirectWorkspaceKind(
  workspaceKind: SessionWorkspaceKind | undefined,
): boolean {
  return workspaceKind === 'direct';
}
