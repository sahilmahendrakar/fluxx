import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { CloudProject, CloudSharedRepo, Project, RepoConfig, Task } from '../../types';
import { resolvePrimaryRepoId, resolveRepoForBranchDiscovery } from '../../repoIdentity';
import { WorktreeCreateError } from '../worktreeCreateError';

const execFile = promisify(execFileCallback);

export type RemoteRepoSessionContext = {
  repoId: string;
  label: string;
  remoteUrl: string;
  baseBranch: string;
  setupScript?: string;
};

async function readOriginUrl(repoRootPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['remote', 'get-url', 'origin'], {
      cwd: repoRootPath,
      encoding: 'utf8',
    });
    const url = stdout.trim();
    return url || null;
  } catch {
    return null;
  }
}

function sharedRepoForId(project: CloudProject, repoId: string): CloudSharedRepo | undefined {
  return project.sharedRepos.find((r) => r.id === repoId);
}

export type ResolveRemoteRepoDeps = {
  readOriginUrl?: (repoRootPath: string) => Promise<string | null>;
  /** When false, remoteUrl is optional (gitless SSH uses a bound folder only). */
  gitEnabled?: boolean;
};

/**
 * Resolves git clone URL and repo metadata for SSH task workspace bootstrap.
 * Does not require a local clone when cloud shared repo metadata includes `remoteUrl`.
 */
export async function resolveRemoteRepoForTaskSession(
  project: Project,
  task: Task,
  repos: RepoConfig[],
  cloudProject?: CloudProject | null,
  deps: ResolveRemoteRepoDeps = {},
): Promise<RemoteRepoSessionContext> {
  const readOrigin = deps.readOriginUrl ?? readOriginUrl;
  const gitEnabled = deps.gitEnabled !== false;
  const primaryId = resolvePrimaryRepoId(repos);
  if (!primaryId) {
    throw new WorktreeCreateError(
      gitEnabled ? 'REMOTE_NON_GIT_UNSUPPORTED' : 'WORKTREE_REPO_INVALID_STATE',
      gitEnabled
        ? 'SSH task execution requires a git-backed project with at least one repository.'
        : 'No repository is configured for this project.',
    );
  }

  const repoCfg = resolveRepoForBranchDiscovery(repos, task.repoId);
  if (!repoCfg) {
    const rid = task.repoId?.trim();
    throw new WorktreeCreateError(
      'WORKTREE_REPO_UNKNOWN',
      rid
        ? `Unknown repository "${rid}" on this project. Pick a repository that exists under Project settings.`
        : 'No repository configured for this project.',
    );
  }

  const label = repoCfg.name ?? repoCfg.id;
  let remoteUrl: string | null = null;

  if (project.kind === 'local') {
    remoteUrl = await readOrigin(repoCfg.rootPath);
  } else {
    const shared = cloudProject ? sharedRepoForId(cloudProject, repoCfg.id) : undefined;
    const bindingPath = project.repoMachineBindings?.[repoCfg.id]?.rootPath?.trim();
    if (bindingPath) {
      remoteUrl = await readOrigin(bindingPath);
    }
    if (!remoteUrl) {
      remoteUrl = shared?.remoteUrl?.trim() ?? null;
    }
  }

  if (!remoteUrl && gitEnabled) {
    throw new WorktreeCreateError(
      'REMOTE_NON_GIT_UNSUPPORTED',
      `Repository "${label}" has no git remote URL for SSH execution. Configure git remotes on this machine or add a remote URL in project settings.`,
    );
  }

  return {
    repoId: repoCfg.id,
    label,
    remoteUrl: remoteUrl ?? '',
    baseBranch: repoCfg.baseBranch,
    setupScript: repoCfg.setupScript,
  };
}
