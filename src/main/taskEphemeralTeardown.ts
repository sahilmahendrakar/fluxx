import path from 'node:path';
import fs from 'node:fs/promises';
import { getRemoteRepoBinding } from '../remoteRepoBindings';
import type { ExecutionDeviceConfig, RepoConfig, Session } from '../types';
import type { LocalBindingStore } from './LocalBindingStore';
import type { ProjectStore } from './ProjectStore';
import type { TerminalBackend } from './terminalBackend/TerminalBackend';
import type { WorktreeService } from './WorktreeService';
import type { ValidationRunStore } from './ValidationRunStore';
import { isDirectWorkspaceKind } from './DirectFolderWorkspaceProvider';
import { worktreePathSegmentsForFluxxBranch } from './fluxxTaskWorkBranchNaming';
import { teardownValidationRunsForTask } from './teardownValidationRunsForTask';
import type { DeviceStore } from './DeviceStore';
import type { GitRemoteWorkspaceProvider } from './ssh/GitRemoteWorkspaceProvider';
import { removeLocalSyncedWorktreeForTask } from './ssh/remoteSshSyncMetadata';

export type TaskEphemeralTeardownValidationDeps = {
  validationRunStore: ValidationRunStore;
  notifyValidationRunChanged?: (runId: string) => void;
};

export type RemoteTaskTeardownDeps = {
  deviceStore: DeviceStore;
  gitRemoteWorkspace: GitRemoteWorkspaceProvider;
  bindingStore: LocalBindingStore;
  projectStore: ProjectStore;
};

/**
 * Stop a task session, close its shells, and remove its git worktree — same
 * side effects as the `session:delete` IPC handler (workspace delete).
 */
export async function deleteSessionWorkspaceAndStop(
  terminalBackend: TerminalBackend,
  worktreeService: WorktreeService,
  sessionId: string,
  resolveGitRepoRoot: (session: Session) => Promise<string | null>,
  remote?: RemoteTaskTeardownDeps,
  repos: readonly RepoConfig[] = [],
): Promise<void> {
  const sessions = await terminalBackend.listSessions();
  const target = sessions.find((s) => s.id === sessionId);
  await terminalBackend.closeShellsForSession(sessionId);
  await terminalBackend.stopSession(sessionId);
  if (!target?.worktreePath) return;

  if (target.deviceKind === 'ssh' && target.deviceId && remote) {
    const device = remote.deviceStore.getDevice(target.deviceId);
    if (device?.kind === 'ssh') {
      const repoId = target.repoId?.trim();
      if (repoId) {
        const boundRepoPath = resolveBoundRemoteRepoPath(remote, target.projectId, device.id, repoId);
        const err = await remote.gitRemoteWorkspace.removeTaskWorktree(device, {
          projectId: target.projectId,
          repoId,
          taskId: target.taskId,
          worktreePath: target.remotePath ?? target.worktreePath,
          ...(boundRepoPath ? { repoPath: boundRepoPath } : {}),
        });
        if (err) {
          console.error('[deleteSessionWorkspaceAndStop] remote worktree remove failed', {
            sessionId,
            err,
          });
        }
      }
    }
    const projectDir = worktreeService.getProjectDir();
    if (projectDir) {
      const localErrors = await removeLocalSyncedWorktreeForTask(worktreeService, repos, {
        projectDir,
        taskId: target.taskId,
        repoId: target.repoId ?? null,
        fluxxWorkBranch: target.branch?.trim() ?? null,
      });
      for (const e of localErrors) {
        console.error('[deleteSessionWorkspaceAndStop] local synced worktree cleanup', {
          sessionId,
          err: e,
        });
      }
    }
    return;
  }

  if (isDirectWorkspaceKind(target.workspaceKind)) {
    return;
  }

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

async function cleanupRemoteTaskOrphans(
  remote: RemoteTaskTeardownDeps,
  taskId: string,
  projectId: string,
  repoId: string | null,
  fluxxWorkBranch: string | null,
): Promise<string[]> {
  const errors: string[] = [];
  for (const device of remote.deviceStore.listDevices()) {
    if (device.kind !== 'ssh' || !device.enabled) continue;
    errors.push(
      ...(await remote.gitRemoteWorkspace.stopOpenTerminalsForTask(device, taskId, projectId)),
    );
    if (repoId) {
      const boundRepoPath = resolveBoundRemoteRepoPath(remote, projectId, device.id, repoId);
      const err = await remote.gitRemoteWorkspace.removeTaskWorktree(device, {
        projectId,
        repoId,
        taskId,
        ...(boundRepoPath ? { repoPath: boundRepoPath } : {}),
      });
      if (err) errors.push(`${device.displayName}: ${err}`);
    }
    void fluxxWorkBranch;
  }
  return errors;
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
  validation?: TaskEphemeralTeardownValidationDeps,
  remote?: RemoteTaskTeardownDeps,
): Promise<string[]> {
  const errors: string[] = [];

  if (validation) {
    const validationResult = await teardownValidationRunsForTask({
      validationRunStore: validation.validationRunStore,
      terminalBackend,
      taskId,
    });
    errors.push(...validationResult.errors);
    for (const runId of validationResult.deletedRunIds) {
      validation.notifyValidationRunChanged?.(runId);
    }
  }

  let sessionIds: string[] = [];
  let projectId: string | null = null;
  try {
    const sessions = await terminalBackend.listSessions();
    const forTask = sessions.filter((s) => s.taskId === taskId);
    sessionIds = forTask.map((s) => s.id);
    projectId = forTask[0]?.projectId ?? null;
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
        remote,
        repos,
      );
    } catch (err) {
      errors.push(`Session ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (remote && projectId) {
    errors.push(
      ...(await cleanupRemoteTaskOrphans(
        remote,
        taskId,
        projectId,
        taskRepoId?.trim() ?? null,
        fluxxWorkBranch?.trim() ?? null,
      )),
    );
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
  errors.push(
    ...(await removeLocalSyncedWorktreeForTask(worktreeService, repos, {
      projectDir,
      taskId,
      repoId: rid ?? null,
      fluxxWorkBranch: fw ?? null,
    })),
  );

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

export function listEnabledSshDevices(deviceStore: DeviceStore): ExecutionDeviceConfig[] {
  return deviceStore.listDevices().filter((d) => d.kind === 'ssh' && d.enabled);
}

function resolveBoundRemoteRepoPath(
  remote: RemoteTaskTeardownDeps,
  projectId: string,
  deviceId: string,
  repoId: string,
): string | undefined {
  const cloudBinding = remote.bindingStore.getRemoteRepoBinding(projectId, deviceId, repoId);
  if (cloudBinding?.remotePath) return cloudBinding.remotePath;
  const local = remote.projectStore.get();
  if (local?.kind === 'local' && local.id === projectId) {
    return getRemoteRepoBinding(local.remoteRepoBindings, deviceId, repoId)?.remotePath;
  }
  return undefined;
}
