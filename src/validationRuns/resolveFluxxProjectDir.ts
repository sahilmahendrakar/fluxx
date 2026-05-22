import {
  resolveCanonicalProjectDir,
  type ProjectDirResolverInput,
} from '../main/projectDirLayout';

/** Active Fluxx-managed project workspace dir (store, else worktree binding). */
export function resolveActiveFluxxProjectDir(
  projectDirFromStore: string | null | undefined,
  projectDirFromWorktree: string | null | undefined,
): string | null {
  const local = projectDirFromStore?.trim();
  if (local) return local;
  const wt = projectDirFromWorktree?.trim();
  if (wt) return wt;
  return null;
}

/**
 * Canonical per-project workspace under `~/.fluxx/projects/<id>/` for local or cloud projects.
 */
export function resolveCanonicalFluxxProjectDir(
  fluxxBaseDir: string,
  input: ProjectDirResolverInput,
): string {
  return resolveCanonicalProjectDir(fluxxBaseDir, input);
}
