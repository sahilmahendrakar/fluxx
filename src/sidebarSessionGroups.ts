import type { SessionTabMeta } from './components/TabBar';
import {
  effectiveTaskRepoId,
  findRepoByIdOrPrimary,
  repoDisplayLabel,
  resolvePrimaryRepoId,
} from './repoIdentity';
import type { Project, RepoConfig, Task } from './types';

export type SidebarSessionGroup = {
  repoId: string;
  label: string;
  items: SessionTabMeta[];
};

export type SidebarSessionLayout =
  | { kind: 'flat'; items: SessionTabMeta[] }
  | { kind: 'grouped'; groups: SidebarSessionGroup[] };

/** Resolved owning repo for a task workspace row (session wins, then task, then primary). */
export function effectiveSessionRepoId(
  session: Pick<import('./types').Session, 'repoId' | 'taskId'>,
  task: Pick<Task, 'repoId'> | undefined,
  primaryRepoId: string,
): string {
  const fromSession = session.repoId?.trim();
  if (fromSession) return fromSession;
  if (task) return effectiveTaskRepoId(task, primaryRepoId);
  return primaryRepoId;
}

/** Repo rows used for sidebar grouping (loaded configs, with cloud shared-repo fallback). */
export function sidebarReposForProject(
  project: Project,
  projectRepos: RepoConfig[] | null,
): ReadonlyArray<Pick<RepoConfig, 'id' | 'name' | 'rootPath'>> {
  if (projectRepos && projectRepos.length > 0) return projectRepos;
  if (project.kind === 'local') return project.repos;
  return project.sharedRepos.map((sr) => ({
    id: sr.id,
    name: sr.name,
    rootPath: project.repoMachineBindings[sr.id]?.rootPath ?? '',
  }));
}

export function buildSidebarSessionLayout(params: {
  sessions: SessionTabMeta[];
  repos: ReadonlyArray<Pick<RepoConfig, 'id' | 'name' | 'rootPath'>>;
  tasks: ReadonlyArray<Pick<Task, 'id' | 'repoId'>>;
}): SidebarSessionLayout {
  const { sessions, repos, tasks } = params;
  if (sessions.length === 0) {
    return { kind: 'flat', items: [] };
  }

  const primaryRepoId = resolvePrimaryRepoId(repos);
  if (!primaryRepoId || repos.length <= 1) {
    return { kind: 'flat', items: sessions };
  }

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const buckets = new Map<string, SessionTabMeta[]>();
  const bucketOrder: string[] = [];

  for (const item of sessions) {
    const task = taskById.get(item.session.taskId);
    const repoId = effectiveSessionRepoId(item.session, task, primaryRepoId);
    let bucket = buckets.get(repoId);
    if (!bucket) {
      bucket = [];
      buckets.set(repoId, bucket);
      bucketOrder.push(repoId);
    }
    bucket.push(item);
  }

  const groups: SidebarSessionGroup[] = [];
  const seen = new Set<string>();

  for (const repo of repos) {
    const items = buckets.get(repo.id);
    if (!items || items.length === 0) continue;
    seen.add(repo.id);
    groups.push({
      repoId: repo.id,
      label: repoDisplayLabel(repo),
      items,
    });
  }

  for (const repoId of bucketOrder) {
    if (seen.has(repoId)) continue;
    const items = buckets.get(repoId);
    if (!items || items.length === 0) continue;
    const repo = findRepoByIdOrPrimary(repos, repoId);
    groups.push({
      repoId,
      label: repo
        ? repoDisplayLabel(repo)
        : repoId
          ? `repo:${repoId.slice(0, 7)}`
          : 'repo',
      items,
    });
  }

  return { kind: 'grouped', groups };
}
