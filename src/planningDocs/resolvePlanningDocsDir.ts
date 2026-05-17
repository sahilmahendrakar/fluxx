import path from 'node:path';

/** Absolute `planning/` directory for the active Flux project workspace. */
export function planningDirFromFluxProjectDir(projectDir: string | null | undefined): string | null {
  if (!projectDir) return null;
  return path.join(projectDir, 'planning');
}

/** Flux-owned project dir (local store, else cloud worktree binding). */
export function fluxxProjectDirOrNull(
  projectDirFromStore: string | null | undefined,
  projectDirFromWorktree: string | null | undefined,
): string | null {
  return projectDirFromStore ?? projectDirFromWorktree ?? null;
}

export function resolvePlanningDocsDirFromSources(
  projectDirFromStore: string | null | undefined,
  projectDirFromWorktree: string | null | undefined,
): string | null {
  return planningDirFromFluxProjectDir(
    fluxxProjectDirOrNull(projectDirFromStore, projectDirFromWorktree),
  );
}
