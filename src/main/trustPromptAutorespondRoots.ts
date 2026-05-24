import os from 'node:os';
import path from 'node:path';
import { fluxxBaseDirPath, legacyFluxBaseDirPath } from './fluxxBaseDir';

/**
 * Absolute path prefixes for PTY cwd checks when auto-responding to trust prompts
 * in Flux-created worktrees or the project's planning directory.
 */
export function trustPromptAutorespondRootsForProject(projectDir: string): string[] {
  const resolvedProject = path.resolve(projectDir);
  return [
    path.join(resolvedProject, 'worktrees'),
    path.join(resolvedProject, 'planning'),
    path.join(fluxxBaseDirPath(), 'worktrees'),
    path.join(legacyFluxBaseDirPath(), 'worktrees'),
  ].map((p) => path.resolve(p));
}

/** True when `cwd` is exactly one root or nested under a root (e.g. task worktree folder). */
export function cwdUnderTrustPromptAutorespondRoots(
  cwd: string,
  roots: readonly string[],
): boolean {
  if (roots.length === 0) return false;
  const r = path.resolve(cwd);
  for (const root of roots) {
    const b = path.resolve(root);
    if (r === b || r.startsWith(`${b}${path.sep}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Trust roots for a remote SSH worktree (POSIX paths on the device).
 * Includes the task worktree and its parent `…/worktrees` directory when present.
 */
export function trustPromptAutorespondRootsForRemoteWorktree(
  remoteWorktreePath: string,
): string[] {
  const wt = remoteWorktreePath.trim().replace(/\\/g, '/');
  if (!wt) return [];
  const roots = new Set<string>([wt]);
  const worktreesSuffix = '/worktrees';
  const idx = wt.indexOf(worktreesSuffix);
  if (idx >= 0) {
    roots.add(wt.slice(0, idx + worktreesSuffix.length));
  }
  return [...roots];
}
