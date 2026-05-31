import type {
  CloudRepoMachineBinding,
  CloudSharedRepo,
  RepoConfig,
} from '../types';
import {
  type GithubOwnerRepo,
  parseGithubOwnerRepoFromRemote,
} from '../githubPrMetadata';
import { deriveRepoIdForRootPath, normalizeRepoRootPathForIdentity, repoRootBasename } from '../repoIdentity';

function repoBasenameFromNameWithOwner(nameWithOwner: string): string {
  const slash = nameWithOwner.lastIndexOf('/');
  return slash >= 0 ? nameWithOwner.slice(slash + 1) : nameWithOwner;
}

export type GithubRepoAttachMetadata = {
  /** `owner/repo` slug from GitHub CLI. */
  nameWithOwner: string;
  url?: string;
  defaultBranch?: string;
};

export type GithubRepoAttachInput = {
  rootPath: string;
  github: GithubRepoAttachMetadata;
};

export const DUPLICATE_LOCAL_PATH_MESSAGE =
  'That local folder is already attached to this project.';
export const DUPLICATE_GITHUB_REPO_MESSAGE =
  'That GitHub repository is already attached to this project.';
export const DUPLICATE_CLOUD_PATH_MESSAGE =
  'That local folder is already bound to this cloud project.';

/** Parses `owner/repo` from GitHub CLI `nameWithOwner`. */
export function parseGithubNameWithOwner(nameWithOwner: string): GithubOwnerRepo | null {
  const trimmed = nameWithOwner.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  const owner = trimmed.slice(0, slash).toLowerCase();
  const repo = trimmed
    .slice(slash + 1)
    .toLowerCase()
    .replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function githubSlugFromRepoConfig(repo: RepoConfig): GithubOwnerRepo | null {
  const owner = repo.githubOwner?.trim().toLowerCase();
  const name = repo.githubName?.trim().toLowerCase().replace(/\.git$/i, '');
  if (owner && name) return { owner, repo: name };
  return null;
}

export function githubSlugFromCloudSharedRepo(repo: CloudSharedRepo): GithubOwnerRepo | null {
  const owner = repo.githubOwner?.trim().toLowerCase();
  const name = repo.githubName?.trim().toLowerCase().replace(/\.git$/i, '');
  if (owner && name) return { owner, repo: name };
  if (repo.remoteUrl?.trim()) {
    return parseGithubOwnerRepoFromRemote(repo.remoteUrl);
  }
  return null;
}

export function githubSlugsMatch(a: GithubOwnerRepo, b: GithubOwnerRepo): boolean {
  return a.owner === b.owner && a.repo === b.repo;
}

export function githubRemoteUrlForAttach(
  metadata: GithubRepoAttachMetadata,
): string | undefined {
  const url = metadata.url?.trim();
  if (url) return url;
  const slug = parseGithubNameWithOwner(metadata.nameWithOwner);
  if (!slug) return undefined;
  return `https://github.com/${slug.owner}/${slug.repo}.git`;
}

export function githubFieldsFromAttachMetadata(
  metadata: GithubRepoAttachMetadata,
): { githubOwner: string; githubName: string; remoteUrl?: string } | null {
  const slug = parseGithubNameWithOwner(metadata.nameWithOwner);
  if (!slug) return null;
  const remoteUrl = githubRemoteUrlForAttach(metadata);
  return {
    githubOwner: slug.owner,
    githubName: slug.repo,
    ...(remoteUrl ? { remoteUrl } : {}),
  };
}

export function findDuplicateLocalRepoByPath(
  repos: ReadonlyArray<RepoConfig>,
  rootPath: string,
): RepoConfig | undefined {
  const target = normalizeRepoRootPathForIdentity(rootPath);
  return repos.find((r) => normalizeRepoRootPathForIdentity(r.rootPath) === target);
}

export function findDuplicateLocalRepoByGithubSlug(
  repos: ReadonlyArray<RepoConfig>,
  slug: GithubOwnerRepo,
): RepoConfig | undefined {
  return repos.find((r) => {
    const existing = githubSlugFromRepoConfig(r);
    return existing !== null && githubSlugsMatch(existing, slug);
  });
}

export function findDuplicateCloudRepoByPath(params: {
  repoMachineBindings: Record<string, CloudRepoMachineBinding>;
  rootPath: string;
}): boolean {
  const target = normalizeRepoRootPathForIdentity(params.rootPath);
  return Object.values(params.repoMachineBindings).some(
    (b) => b?.rootPath && normalizeRepoRootPathForIdentity(b.rootPath) === target,
  );
}

export function findDuplicateCloudSharedRepoByGithubSlug(
  sharedRepos: ReadonlyArray<CloudSharedRepo>,
  slug: GithubOwnerRepo,
): CloudSharedRepo | undefined {
  return sharedRepos.find((sr) => {
    const existing = githubSlugFromCloudSharedRepo(sr);
    return existing !== null && githubSlugsMatch(existing, slug);
  });
}

export function buildCloudSharedRepoForGithubAttach(params: {
  projectId: string;
  rootPath: string;
  sharedRepos: ReadonlyArray<CloudSharedRepo>;
  github: GithubRepoAttachMetadata;
}): CloudSharedRepo | null {
  const fields = githubFieldsFromAttachMetadata(params.github);
  if (!fields) return null;

  const existingIds = new Set(params.sharedRepos.map((r) => r.id));
  let repoId = deriveRepoIdForRootPath({
    projectId: params.projectId,
    rootPath: params.rootPath,
  });
  let salt = 1;
  while (existingIds.has(repoId)) {
    repoId = deriveRepoIdForRootPath({
      projectId: params.projectId,
      rootPath: params.rootPath,
      salt: `dup-${salt}`,
    });
    salt += 1;
  }

  const displayName =
    repoBasenameFromNameWithOwner(params.github.nameWithOwner) ||
    repoRootBasename(params.rootPath) ||
    `repo:${repoId.slice(0, 7)}`;

  const baseBranch =
    (params.github.defaultBranch ?? '').trim() || 'main';

  return {
    id: repoId,
    name: displayName,
    baseBranch,
    ...(fields.remoteUrl ? { remoteUrl: fields.remoteUrl } : {}),
    githubOwner: fields.githubOwner,
    githubName: fields.githubName,
  };
}

export function validateGithubRepoAttachForLocal(params: {
  repos: ReadonlyArray<RepoConfig>;
  input: GithubRepoAttachInput;
}): { ok: true } | { ok: false; message: string } {
  if (findDuplicateLocalRepoByPath(params.repos, params.input.rootPath)) {
    return { ok: false, message: DUPLICATE_LOCAL_PATH_MESSAGE };
  }
  const slug = parseGithubNameWithOwner(params.input.github.nameWithOwner);
  if (slug && findDuplicateLocalRepoByGithubSlug(params.repos, slug)) {
    return { ok: false, message: DUPLICATE_GITHUB_REPO_MESSAGE };
  }
  return { ok: true };
}

export function validateGithubRepoAttachForCloud(params: {
  projectId: string;
  sharedRepos: ReadonlyArray<CloudSharedRepo>;
  repoMachineBindings: Record<string, CloudRepoMachineBinding>;
  input: GithubRepoAttachInput;
}): { ok: true; sharedRepo: CloudSharedRepo } | { ok: false; message: string } {
  if (findDuplicateCloudRepoByPath({
    repoMachineBindings: params.repoMachineBindings,
    rootPath: params.input.rootPath,
  })) {
    return { ok: false, message: DUPLICATE_CLOUD_PATH_MESSAGE };
  }
  const slug = parseGithubNameWithOwner(params.input.github.nameWithOwner);
  if (slug) {
    const dup = findDuplicateCloudSharedRepoByGithubSlug(params.sharedRepos, slug);
    if (dup) {
      return { ok: false, message: DUPLICATE_GITHUB_REPO_MESSAGE };
    }
  }
  const sharedRepo = buildCloudSharedRepoForGithubAttach({
    projectId: params.projectId,
    rootPath: params.input.rootPath,
    sharedRepos: params.sharedRepos,
    github: params.input.github,
  });
  if (!sharedRepo) {
    return { ok: false, message: 'Invalid GitHub repository name.' };
  }
  return { ok: true, sharedRepo };
}
