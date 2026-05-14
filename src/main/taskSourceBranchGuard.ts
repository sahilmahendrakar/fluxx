import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { Task } from '../types';
import { effectiveTaskSourceBranchShort } from '../taskBranches';
import { expectedFluxWorkBranchForTask } from './fluxTaskBranch';
import { worktreePathSegmentsForFluxBranch } from './fluxTaskWorkBranchNaming';

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
 * an on-disk worktree directory, or the Flux task work branch (legacy `flux/task-*`
 * or persisted `fluxWorkBranch` on the task).
 */
export async function taskHasBlockingWorkspaceState(input: {
  taskId: string;
  /** Persisted Flux work branch when known (Firestore / tasks.json). */
  fluxWorkBranch?: string | null;
  /** When set, also treats `worktrees/<repoId>/<taskId>` as blocking (`multi-repo2`). */
  repoId?: string | null;
  listSessions: () => Promise<{ taskId: string }[]>;
  projectDir: string;
  /** Every configured clone root (`RepoConfig.rootPath`) for this project. */
  repoGitRoots: readonly string[];
}): Promise<boolean> {
  const sessions = await input.listSessions();
  if (sessions.some((s) => s.taskId === input.taskId)) {
    return true;
  }

  const rid = input.repoId?.trim();
  const fw = input.fluxWorkBranch?.trim();
  if (rid && fw) {
    const fluxScoped = path.join(input.projectDir, 'worktrees', rid, ...worktreePathSegmentsForFluxBranch(fw));
    try {
      await fs.access(fluxScoped);
      return true;
    } catch {
      /* no flux-scoped dir */
    }
  }

  if (rid) {
    const repoScoped = path.join(input.projectDir, 'worktrees', rid, input.taskId);
    try {
      await fs.access(repoScoped);
      return true;
    } catch {
      /* no repo-scoped dir */
    }
  }

  const legacyDir = path.join(input.projectDir, 'worktrees', input.taskId);
  try {
    await fs.access(legacyDir);
    return true;
  } catch {
    /* no legacy dir */
  }

  const worktreesRoot = path.join(input.projectDir, 'worktrees');
  try {
    const names = await fs.readdir(worktreesRoot);
    for (const name of names) {
      if (!name.trim() || name === input.taskId) continue;
      const nested = path.join(worktreesRoot, name, input.taskId);
      try {
        await fs.access(nested);
        return true;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no worktrees root */
  }

  if (!rid && fw) {
    const worktreesRoot = path.join(input.projectDir, 'worktrees');
    try {
      const names = await fs.readdir(worktreesRoot);
      for (const name of names) {
        if (!name.trim()) continue;
        const fluxNested = path.join(worktreesRoot, name, ...worktreePathSegmentsForFluxBranch(fw));
        try {
          await fs.access(fluxNested);
          return true;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* no worktrees root */
    }
  }

  const branch = expectedFluxWorkBranchForTask({
    id: input.taskId,
    fluxWorkBranch: input.fluxWorkBranch ?? undefined,
  });
  const seen = new Set<string>();
  for (const raw of input.repoGitRoots) {
    const cwd = path.resolve(raw);
    if (seen.has(cwd)) continue;
    seen.add(cwd);
    try {
      await execFile('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
        cwd,
      });
      return true;
    } catch {
      /* no branch in this repo */
    }
  }
  return false;
}
