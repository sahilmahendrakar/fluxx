import fs from 'node:fs/promises';
import path from 'node:path';
import type { ActiveProjectKey, RepoConfig } from '../types';
import type { AppStateStore } from './AppStateStore';
import type { DaemonClient } from './DaemonClient';
import type { LocalBindingStore } from './LocalBindingStore';
import type { ProjectStore } from './ProjectStore';
import { assertSafeToDeleteLegacyFlatProjectsRoot } from './projectDirLayout';
import { WorktreeService } from './WorktreeService';

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function stopDaemonResourcesForProject(
  daemonClient: DaemonClient,
  projectId: string,
): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const sessions = await daemonClient.listSessions();
    for (const s of sessions) {
      if (s.projectId !== projectId) continue;
      try {
        await daemonClient.closeShellsForSession(s.id);
      } catch (err) {
        warnings.push(`closeShellsForSession(${s.id}): ${errText(err)}`);
      }
      try {
        await daemonClient.stopSession(s.id);
      } catch (err) {
        warnings.push(`stopSession(${s.id}): ${errText(err)}`);
      }
    }
  } catch (err) {
    warnings.push(`listSessions: ${errText(err)}`);
  }

  try {
    const planning = await daemonClient.listPlanning();
    for (const p of planning) {
      if (p.projectId !== projectId) continue;
      try {
        await daemonClient.stopPlanning(p.id);
      } catch (err) {
        warnings.push(`stopPlanning(${p.id}): ${errText(err)}`);
      }
    }
  } catch (err) {
    warnings.push(`listPlanning: ${errText(err)}`);
  }

  return warnings;
}

/**
 * Removes Flux-managed task worktrees under `projectDir/worktrees/` using owning git roots
 * from `repos` (legacy flat `worktrees/<taskId>` and `worktrees/<repoId>/<taskId>`).
 */
export async function removeFluxWorktreesUnderProjectDir(
  projectDir: string,
  repos: readonly RepoConfig[],
): Promise<string[]> {
  const errors: string[] = [];
  const primaryRoot = repos[0]?.rootPath?.trim()
    ? path.resolve(repos[0].rootPath)
    : '';
  const svc = new WorktreeService(primaryRoot || '', projectDir);

  const worktreesRoot = path.join(projectDir, 'worktrees');
  let entries;
  try {
    entries = await fs.readdir(worktreesRoot, { withFileTypes: true });
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT') return errors;
    errors.push(`list worktrees: ${errText(err)}`);
    return errors;
  }

  const repoIds = new Set(repos.map((r) => r.id));

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    const first = path.join(worktreesRoot, name);

    if (repoIds.has(name)) {
      let sub;
      try {
        sub = await fs.readdir(first, { withFileTypes: true });
      } catch (err) {
        errors.push(`read ${first}: ${errText(err)}`);
        continue;
      }
      const repoCfg = repos.find((r) => r.id === name);
      const gitRoot = repoCfg?.rootPath?.trim() ? path.resolve(repoCfg.rootPath) : null;
      for (const sEnt of sub) {
        if (!sEnt.isDirectory()) continue;
        const wt = path.join(first, sEnt.name);
        try {
          await svc.remove(wt, gitRoot);
        } catch (err) {
          errors.push(`remove worktree ${wt}: ${errText(err)}`);
        }
      }
      try {
        await fs.rm(first, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    } else {
      const gitRoot = primaryRoot || null;
      try {
        await svc.remove(first, gitRoot);
      } catch (err) {
        errors.push(`remove worktree ${first}: ${errText(err)}`);
      }
    }
  }

  try {
    await fs.rm(worktreesRoot, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }

  return errors;
}

async function deleteFluxProjectMaterializationDir(
  fluxBaseDir: string,
  projectDir: string,
): Promise<void> {
  await assertSafeToDeleteLegacyFlatProjectsRoot(fluxBaseDir, projectDir);
  await fs.rm(projectDir, { recursive: true, force: true });
}

export type RemoveFluxOwnedLocalStateResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
  deletedMaterializationDirs: string[];
};

export type RemoveFluxOwnedLocalStateDeps = {
  key: ActiveProjectKey;
  fluxBaseDir: string;
  projectStore: ProjectStore;
  daemonClient: DaemonClient;
  appStateStore: AppStateStore;
  bindingStore: LocalBindingStore;
  clearInMemoryWorkspaceIfActive: () => Promise<void>;
};

/**
 * Deletes Flux-owned workspace directories for `key.id`, stops matching daemon sessions,
 * clears persisted tab state, optionally clears cloud local bindings, and resets the
 * active workspace when that project is open. Does not delete user repository clones
 * (`RepoConfig.rootPath`).
 */
export async function removeFluxOwnedLocalState(
  deps: RemoveFluxOwnedLocalStateDeps,
): Promise<RemoveFluxOwnedLocalStateResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const deletedMaterializationDirs: string[] = [];
  const { key, fluxBaseDir, projectStore, daemonClient, appStateStore, bindingStore } =
    deps;

  warnings.push(...(await stopDaemonResourcesForProject(daemonClient, key.id)));

  const dirs = await projectStore.listMaterializationDirsForProjectId(key.id);
  const sorted = [...dirs].sort((a, b) => b.length - a.length);

  for (const projectDir of sorted) {
    const cfg = await projectStore.readStoredProjectConfig(projectDir);
    if (!cfg || cfg.id !== key.id) {
      errors.push(`Skipped unexpected directory (config id mismatch): ${projectDir}`);
      continue;
    }

    const wtErrs = await removeFluxWorktreesUnderProjectDir(projectDir, cfg.repos);
    errors.push(...wtErrs);

    try {
      await deleteFluxProjectMaterializationDir(fluxBaseDir, projectDir);
      deletedMaterializationDirs.push(projectDir);
    } catch (err) {
      errors.push(`Delete project workspace ${projectDir}: ${errText(err)}`);
    }
  }

  if (key.kind === 'cloud') {
    try {
      await bindingStore.remove(key.id);
    } catch (err) {
      errors.push(`Clear local cloud binding: ${errText(err)}`);
    }
  }

  const activeKey = appStateStore.get().activeProjectKey;
  const wasActive = activeKey?.kind === key.kind && activeKey?.id === key.id;
  await appStateStore.clearProjectFluxState(key, { clearActiveNavigation: wasActive });

  if (wasActive) {
    await deps.clearInMemoryWorkspaceIfActive();
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
    deletedMaterializationDirs,
  };
}
