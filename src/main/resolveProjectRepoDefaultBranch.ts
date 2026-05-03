import path from 'node:path';
import type { ProjectStore } from './ProjectStore';

/**
 * Repo default branch short name for the active git root, matching
 * `tasks:requestPullRequestFromAgent` / worktree session logic (RepoConfig.baseBranch
 * for the matching repo, else first repo, else `main`).
 */
export async function resolveProjectRepoDefaultBranchShort(params: {
  projectStore: ProjectStore;
  activeProjectDir: () => string;
  rootPath: string | null;
}): Promise<string> {
  const { projectStore, activeProjectDir, rootPath } = params;
  let repoDefaultBranch = 'main';
  if (!rootPath) return repoDefaultBranch;
  try {
    const repos = await projectStore.getReposAt(activeProjectDir());
    const norm = (p: string) => path.normalize(p);
    const match =
      repos.find((r) => norm(r.rootPath) === norm(rootPath)) ?? repos[0];
    const b = (match?.baseBranch ?? 'main').trim();
    if (b) repoDefaultBranch = b;
  } catch {
    /* keep default */
  }
  return repoDefaultBranch;
}
