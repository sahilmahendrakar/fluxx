import path from 'node:path';
import fs from 'node:fs/promises';
import type { RepoConfig, Session } from '../types';
import type { TerminalBackend } from './terminalBackend/TerminalBackend';
import type { WorktreeService } from './WorktreeService';
import { worktreePathSegmentsForFluxxBranch } from './fluxxTaskWorkBranchNaming';

/**
 * Stop a task session, close its shells, and remove its git worktree — same
 * side effects as the `session:delete` IPC handler (workspace delete).
 */
export async function deleteSessionWorkspaceAndStop(
  terminalBackend: TerminalBackend,
  worktreeService: WorktreeService,
  sessionId: string,
  resolveGitRepoRoot: (session: Session) => Promise<string | null>,
): Promise<void> {
  const sessions = await terminalBackend.listSessions();
  const target = sessions.find((s) => s.id === sessionId);
  await terminalBackend.closeShellsForSession(sessionId);
  await terminalBackend.stopSession(sessionId);
  if (target?.worktreePath) {
    try {
      const gitRoot = await resolveGitRepoRoot(target);
      await worktreeService.remove(target.worktreePath, gitRoot);
    } catch (err: unknown) {
      console.error('[deleteSessionWorkspaceAndStop] worktree remove failed', {
        sessionId,
        err,
      });
    }
  }
}

/**
 * Tear down every task session and worktree tied to `taskId`, then remove a
 * possible orphan worktree directory (e.g. after archive left the folder).
 * Does not touch the task record.
 */
export async function teardownEphemeralResourcesForTask(
  terminalBackend: TerminalBackend,
  worktreeService: WorktreeService,
  taskId: string,
  repos: readonly RepoConfig[],
  /** Persists which repository this task targets — drives repo-scoped `worktrees/<repoId>/…` cleanup. */
  taskRepoId?: string | null,
  /** Persisted Flux work branch for nested `worktrees/<repoId>/<branch-segments>` cleanup. */
  fluxxWorkBranch?: string | null,
): Promise<string[]> {
  const errors: string[] = [];
  let sessionIds: string[] = [];
  try {
    const sessions = await terminalBackend.listSessions();
    sessionIds = sessions.filter((s) => s.taskId === taskId).map((s) => s.id);
  } catch (err) {
    errors.push(
      `Could not list sessions: ${err instanceof Error ? err.message : String(err)}`,
    );
    return errors;
  }

  async function gitRootFromSession(sess: Pick<Session, 'repoId'>): Promise<string | null> {
    const rid = sess.repoId?.trim();
    if (rid) {
      const cfg = repos.find((r) => r.id === rid);
      const rp = cfg?.rootPath?.trim();
      return rp ? path.resolve(rp) : null;
    }
    const primary = repos[0]?.rootPath?.trim();
    return primary ? path.resolve(primary) : null;
  }

  const resolveStored = async (sess: Session): Promise<string | null> => gitRootFromSession(sess);

  for (const id of sessionIds) {
    try {
      await deleteSessionWorkspaceAndStop(
        terminalBackend,
        worktreeService,
        id,
        resolveStored,
      );
    } catch (err) {
      errors.push(`Session ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const projectDir = worktreeService.getProjectDir();
  if (!projectDir) {
    return errors;
  }

  const legacyOrphan = path.join(projectDir, 'worktrees', taskId);
  try {
    await fs.access(legacyOrphan);
    const primaryGit = repos[0]?.rootPath?.trim() ?? '';
    await worktreeService.remove(legacyOrphan, primaryGit ? path.resolve(primaryGit) : null);
  } catch {
    /* no legacy orphan */
  }

  const rid = taskRepoId?.trim();
  const fw = fluxxWorkBranch?.trim();
  if (rid && fw) {
    const fluxScoped = path.join(projectDir, 'worktrees', rid, ...worktreePathSegmentsForFluxxBranch(fw));
    try {
      await fs.access(fluxScoped);
      const cfg = repos.find((r) => r.id === rid);
      const gitRoot = cfg?.rootPath?.trim() ? path.resolve(cfg.rootPath) : null;
      try {
        await worktreeService.remove(fluxScoped, gitRoot);
      } catch (err) {
        errors.push(
          `Worktree cleanup (flux ${rid}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch {
      /* no flux-scoped dir */
    }
  }

  if (rid) {
    const repoScoped = path.join(projectDir, 'worktrees', rid, taskId);
    try {
      await fs.access(repoScoped);
      const cfg = repos.find((r) => r.id === rid);
      const gitRoot = cfg?.rootPath?.trim() ? path.resolve(cfg.rootPath) : null;
      try {
        await worktreeService.remove(repoScoped, gitRoot);
      } catch (err) {
        errors.push(
          `Worktree cleanup (${rid}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch {
      /* no repo-scoped folder */
    }
  }

  const worktreesRoot = path.join(projectDir, 'worktrees');
  try {
    const names = await fs.readdir(worktreesRoot);
    for (const name of names) {
      if (!name.trim() || name === taskId) continue;
      const candidate = path.join(worktreesRoot, name, taskId);
      try {
        await fs.access(candidate);
      } catch {
        continue;
      }
      const cfg = repos.find((r) => r.id === name);
      const gitRoot = cfg?.rootPath?.trim() ? path.resolve(cfg.rootPath) : null;
      try {
        await worktreeService.remove(candidate, gitRoot);
      } catch (err) {
        errors.push(
          `Worktree cleanup (${name}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch {
    /* no worktrees root */
  }

  if (!rid && fw) {
    try {
      const names = await fs.readdir(worktreesRoot);
      for (const name of names) {
        if (!name.trim()) continue;
        const fluxNested = path.join(
          worktreesRoot,
          name,
          ...worktreePathSegmentsForFluxxBranch(fw),
        );
        try {
          await fs.access(fluxNested);
        } catch {
          continue;
        }
        const cfg = repos.find((r) => r.id === name);
        const gitRoot = cfg?.rootPath?.trim() ? path.resolve(cfg.rootPath) : null;
        try {
          await worktreeService.remove(fluxNested, gitRoot);
        } catch (err) {
          errors.push(
            `Worktree cleanup (flux ${name}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch {
      /* no worktrees root */
    }
  }

  return errors;
}
