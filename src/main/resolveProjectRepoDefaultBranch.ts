import path from 'node:path';
import type { ProjectStore } from './ProjectStore';
import type { RepoConfig } from '../types';

/**
 * Repo default branch short name for the active git root, matching
 * `tasks:requestPullRequestFromAgent` / worktree session logic (RepoConfig.baseBranch
 * for the matching repo, else first repo, else `main`).
 *
 * When `repoId` is set (multi-repo2), that repo's `baseBranch` wins before `rootPath` matching.
 */
export async function resolveProjectRepoDefaultBranchShort(params: {
  projectStore: ProjectStore;
  activeProjectDir: () => string;
  rootPath: string | null;
  repoId?: string;
}): Promise<string> {
  const { projectStore, activeProjectDir, rootPath, repoId } = params;
  let repoDefaultBranch = 'main';
  const rid = repoId?.trim();
  if (!rootPath && !rid) return repoDefaultBranch;
  try {
    const repos = await projectStore.getReposAt(activeProjectDir());
    let match: RepoConfig | undefined;
    if (rid) {
      match = repos.find((r) => r.id === rid);
    }
    if (!match && rootPath) {
      const norm = (p: string) => path.normalize(p);
      match =
        repos.find((r) => norm(r.rootPath) === norm(rootPath)) ?? repos[0];
    }
    if (!match) {
      match = repos[0];
    }
    const b = (match?.baseBranch ?? 'main').trim();
    if (b) repoDefaultBranch = b;
  } catch {
    /* keep default */
  }
  return repoDefaultBranch;
}
