/** Stable JSON shape for `fluxx repo *` attach commands (`--json`). */
export interface RepoAttachCliSuccess {
  repoId: string;
  rootPath: string;
  github?: {
    owner: string;
    name: string;
    nameWithOwner: string;
    url?: string;
  };
  /** True when this operation created a new GitHub remote repository. */
  githubRepoCreated: boolean;
  /** True when the repository was newly attached to the active project. */
  newlyAttached: boolean;
}

export interface RepoAttachCliFailure {
  ok: false;
  error: string;
  code?: string;
  retryable?: boolean;
  /** Present when remote creation succeeded but clone/attach did not. */
  github?: {
    nameWithOwner: string;
    url?: string;
  };
  githubRepoCreated?: boolean;
}

export function isRetryableRepoAttachCode(code: string | undefined): boolean {
  return (
    code === 'GH_REPO_CLONE_FAILED' ||
    code === 'GH_NOT_AUTHENTICATED' ||
    code === 'GH_COMMAND_FAILED' ||
    code === 'GH_NOT_INSTALLED'
  );
}
