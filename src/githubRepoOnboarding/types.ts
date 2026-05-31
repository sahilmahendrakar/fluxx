/** GitHub.com hostname used for `gh auth status` and repo operations. */
export const GITHUB_COM_HOSTNAME = 'github.com';

export type GithubRepoVisibility = 'public' | 'private' | 'internal';

export type GithubRepoOnboardingErrorCode =
  | 'GH_NOT_INSTALLED'
  | 'GH_NOT_AUTHENTICATED'
  | 'GH_PERMISSION_DENIED'
  | 'GH_REPO_CREATE_FAILED'
  | 'GH_REPO_CLONE_FAILED'
  | 'CLONE_DESTINATION_EXISTS'
  | 'INVALID_INPUT'
  | 'GH_COMMAND_FAILED';

export type GithubRepoOnboardingError = {
  ok: false;
  code: GithubRepoOnboardingErrorCode;
  message: string;
};

export type GithubRepoOnboardingOk<T> = { ok: true } & T;

export type GithubRepoOnboardingResult<T> =
  | GithubRepoOnboardingOk<T>
  | GithubRepoOnboardingError;

/** Minimal repo row from `gh repo list --json` (optional fields omitted on older gh). */
export interface GithubCliRepoSummary {
  nameWithOwner: string;
  url?: string;
  sshUrl?: string;
  description?: string;
  visibility?: string;
  isPrivate?: boolean;
  defaultBranchRef?: { name?: string } | null;
  updatedAt?: string;
}

export interface GithubCliPrerequisites {
  installed: boolean;
  version?: string;
  authenticated: boolean;
  /** Actionable guidance when `installed` or `authenticated` is false. */
  message?: string;
}

export type GithubCliPrerequisitesResult = GithubRepoOnboardingResult<{
  prerequisites: GithubCliPrerequisites;
}>;

export interface GithubRepoListInput {
  owner?: string;
  limit?: number;
}

export type GithubRepoListResult = GithubRepoOnboardingResult<{
  repos: GithubCliRepoSummary[];
}>;

export interface GithubRepoCreateInput {
  /** Short name or `owner/name`. */
  name: string;
  /** Used when `name` has no `/` segment. */
  owner?: string;
  visibility: GithubRepoVisibility;
  description?: string;
}

export type GithubRepoCreateResult = GithubRepoOnboardingResult<{
  nameWithOwner: string;
  url?: string;
}>;

export interface GithubRepoCloneInput {
  /** `owner/name` of an existing GitHub repository. */
  repo: string;
  /** Final clone destination directory (not a parent folder). */
  destination: string;
}

export type GithubRepoCloneResult = GithubRepoOnboardingResult<{
  destination: string;
  nameWithOwner: string;
}>;

export interface GithubCloneDestinationCheckInput {
  destination: string;
}

export type GithubCloneDestinationCheckResult = GithubRepoOnboardingResult<{
  available: true;
}>;

/** HTTP automation ops for GitHub repo onboarding (main-process `gh` only). */
export type GithubRepoOnboardingAutomationOp =
  | 'repo.github.prerequisites'
  | 'repo.github.list'
  | 'repo.github.create'
  | 'repo.github.clone'
  | 'repo.github.checkCloneDestination';
