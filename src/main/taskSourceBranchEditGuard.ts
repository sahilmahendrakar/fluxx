import type { Session } from '../types';
import { resolveTaskWorktreePath } from './openWorkspacePath';

/**
 * Throws when the task must not change {@link Task.sourceBranch} /
 * {@link Task.createSourceBranchIfMissing} because a session or worktree
 * already exists (local daemon + on-disk layout under the Flux project dir).
 */
export async function assertTaskSourceBranchMetadataEditable(
  taskId: string,
  projectDir: string,
  listSessions: () => Promise<Session[]>,
): Promise<void> {
  const sessions = await listSessions();
  if (sessions.some((s) => s.taskId === taskId)) {
    throw new Error(
      'Cannot change task branch metadata: a Flux session still exists for this task. Stop or remove the workspace first.',
    );
  }
  const worktree = await resolveTaskWorktreePath(taskId, listSessions, projectDir);
  if (worktree) {
    throw new Error(
      'Cannot change task branch metadata: a worktree directory still exists for this task. Remove it first.',
    );
  }
}
