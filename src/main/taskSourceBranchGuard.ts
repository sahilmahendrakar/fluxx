import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { Task } from '../types';
import { effectiveTaskSourceBranchShort } from '../taskBranches';
import { fluxTaskWorkBranchName } from './fluxTaskBranch';

const execFile = promisify(execFileCallback);

export type TaskSourceBranchPatchPreview = Partial<
  Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing'>
>;

/**
 * Whether applying `patch` would change the effective source branch or the
 * persisted create-if-missing flag compared to `previous`.
 */
export function taskSourceBranchSettingsWouldChange(
  previous: Task,
  patch: TaskSourceBranchPatchPreview,
  projectDefaultBranchShort: string,
): boolean {
  if (patch.sourceBranch === undefined && patch.createSourceBranchIfMissing === undefined) {
    return false;
  }

  const merged: Task = { ...previous, ...patch };
  if (patch.sourceBranch !== undefined) {
    const t = patch.sourceBranch.trim();
    if (t.length === 0) {
      delete merged.sourceBranch;
    } else {
      merged.sourceBranch = t;
    }
  }

  const prevEff = effectiveTaskSourceBranchShort(previous, projectDefaultBranchShort);
  const nextEff = effectiveTaskSourceBranchShort(merged, projectDefaultBranchShort);
  if (prevEff !== nextEff) {
    return true;
  }

  if (patch.createSourceBranchIfMissing === undefined) {
    return false;
  }
  return patch.createSourceBranchIfMissing !== previous.createSourceBranchIfMissing;
}

/**
 * True when a Flux task workspace is present: any daemon session for the task,
 * an on-disk worktree directory, or the generated `flux/task-*` branch.
 */
export async function taskHasBlockingWorkspaceState(input: {
  taskId: string;
  listSessions: () => Promise<{ taskId: string }[]>;
  projectDir: string;
  rootPath: string;
}): Promise<boolean> {
  const sessions = await input.listSessions();
  if (sessions.some((s) => s.taskId === input.taskId)) {
    return true;
  }

  const wt = path.join(input.projectDir, 'worktrees', input.taskId);
  try {
    await fs.access(wt);
    return true;
  } catch {
    /* no dir */
  }

  const branch = fluxTaskWorkBranchName(input.taskId);
  try {
    await execFile('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: input.rootPath,
    });
    return true;
  } catch {
    return false;
  }
}
