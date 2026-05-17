import type { CloudSharedRepo } from './types';
import {
  deriveRepoIdForRootPath,
  deriveStablePrimaryRepoIdForProject,
  normalizeRepoRootPathForIdentity,
  repoRootBasename,
} from './repoIdentity';

export interface CloudProjectCreateRepoInput {
  rootPath: string;
  name?: string;
  baseBranch?: string;
  remoteUrl?: string;
}

/**
 * Assigns stable shared repo ids for a new cloud project and picks the primary id.
 * Uses the same helpers as local multi-repo create ({@link deriveStablePrimaryRepoIdForProject}).
 */
export function buildCloudSharedReposAtCreate(
  projectId: string,
  inputs: CloudProjectCreateRepoInput[],
  primaryRootPath?: string,
): { repos: CloudSharedRepo[]; primaryRepoId: string } {
  if (inputs.length === 0) {
    throw new Error('At least one repository is required.');
  }
  const normalized = inputs.map((input) => {
    const rootPath = normalizeRepoRootPathForIdentity(input.rootPath);
    return {
      rootPath,
      name: (input.name ?? '').trim() || repoRootBasename(rootPath) || `repo`,
      baseBranch: (input.baseBranch ?? 'main').trim() || 'main',
      remoteUrl: input.remoteUrl?.trim() || undefined,
    };
  });

  const primaryNorm =
    primaryRootPath != null && primaryRootPath.trim() !== ''
      ? normalizeRepoRootPathForIdentity(primaryRootPath)
      : normalized[0].rootPath;

  const primaryRepoId = deriveStablePrimaryRepoIdForProject({
    projectId,
    rootPath: primaryNorm,
  });

  const repos: CloudSharedRepo[] = [];
  const usedIds = new Set<string>();

  for (const row of normalized) {
    let id =
      row.rootPath === primaryNorm
        ? primaryRepoId
        : deriveRepoIdForRootPath({ projectId, rootPath: row.rootPath });
    let salt = 1;
    while (usedIds.has(id)) {
      id = deriveRepoIdForRootPath({
        projectId,
        rootPath: row.rootPath,
        salt: `dup-${salt}`,
      });
      salt += 1;
    }
    usedIds.add(id);
    const repo: CloudSharedRepo = {
      id,
      name: row.name,
      baseBranch: row.baseBranch,
    };
    if (row.remoteUrl) repo.remoteUrl = row.remoteUrl;
    repos.push(repo);
  }

  const primaryHit = repos.find((r) => r.id === primaryRepoId);
  if (!primaryHit) {
    throw new Error('primaryRepoId does not match any repository path.');
  }

  return { repos, primaryRepoId };
}
