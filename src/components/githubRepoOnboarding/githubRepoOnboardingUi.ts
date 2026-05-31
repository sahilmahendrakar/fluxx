import type {
  GithubCliPrerequisites,
  GithubRepoVisibility,
} from '../../githubRepoOnboarding/types';

export function isGithubRepoAddOptionEnabled(gitIntegrationEnabled: boolean): boolean {
  return gitIntegrationEnabled;
}

export function githubRepoAddOptionDisabledTitle(gitIntegrationEnabled: boolean): string | undefined {
  if (gitIntegrationEnabled) return undefined;
  return 'GitHub clone and create require git integration to be enabled.';
}

export function repoBasenameFromNameWithOwner(nameWithOwner: string): string {
  const slash = nameWithOwner.lastIndexOf('/');
  return slash >= 0 ? nameWithOwner.slice(slash + 1) : nameWithOwner;
}

export function joinCloneDestinationPath(parentPath: string, repoBasename: string): string {
  const parent = parentPath.replace(/[/\\]+$/, '');
  const child = repoBasename.replace(/^[/\\]+/, '');
  const sep = parent.includes('\\') ? '\\' : '/';
  return `${parent}${sep}${child}`;
}

export type NewGithubRepoFormValues = {
  owner: string;
  name: string;
  visibility: GithubRepoVisibility;
  description: string;
  confirmNonPrivate: boolean;
};

export function validateNewGithubRepoForm(values: NewGithubRepoFormValues): string | null {
  const name = values.name.trim();
  if (!name) return 'Repository name is required.';
  if (name.includes('/')) {
    return 'Use the owner field for organization repos; the name should not include /.';
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return 'Repository name contains invalid characters.';
  }

  const owner = values.owner.trim();
  if (owner && !/^[a-zA-Z0-9._-]+$/.test(owner)) {
    return 'Owner contains invalid characters.';
  }

  if (values.visibility !== 'private' && !values.confirmNonPrivate) {
    return `Confirm that you want a ${values.visibility} repository.`;
  }
  return null;
}

export function buildGithubRepoCreatePayload(
  values: NewGithubRepoFormValues,
): { name: string; owner?: string; visibility: GithubRepoVisibility; description?: string } {
  const name = values.name.trim();
  const owner = values.owner.trim();
  const description = values.description.trim();
  return {
    name,
    ...(owner ? { owner } : {}),
    visibility: values.visibility,
    ...(description ? { description } : {}),
  };
}

export type GithubPrerequisitesUiState = 'ready' | 'blocked';

export function githubPrerequisitesUiState(
  prerequisites: GithubCliPrerequisites | null | undefined,
): GithubPrerequisitesUiState {
  if (!prerequisites?.installed || !prerequisites.authenticated) return 'blocked';
  return 'ready';
}

export function githubPrerequisitesHeading(prerequisites: GithubCliPrerequisites): string {
  if (!prerequisites.installed) return 'Install GitHub CLI';
  if (!prerequisites.authenticated) return 'Sign in to GitHub';
  return 'GitHub CLI ready';
}

export function filterGithubRepos<T extends { nameWithOwner: string; description?: string }>(
  repos: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return repos;
  return repos.filter(
    (r) =>
      r.nameWithOwner.toLowerCase().includes(q) ||
      (r.description?.toLowerCase().includes(q) ?? false),
  );
}

export type GithubRepoOnboardingModalStep =
  | 'prerequisites'
  | 'source'
  | 'existing'
  | 'new'
  | 'destination'
  | 'progress'
  | 'success'
  | 'error';

export function githubRepoOnboardingProgressLabel(args: {
  mode: 'existing' | 'new';
  phase: 'create' | 'clone' | 'attach';
}): string {
  if (args.phase === 'create') return 'Creating GitHub repository…';
  if (args.phase === 'clone') return 'Cloning repository…';
  if (args.mode === 'existing') return 'Attaching cloned repository…';
  return 'Attaching repository…';
}
