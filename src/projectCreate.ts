import path from 'node:path';
import type { Agent, AgentSessionModelDefaults, RepoConfig } from './types';
import {
  deriveRepoIdForRootPath,
  deriveStablePrimaryRepoIdForProject,
  normalizeRepoRootPathForIdentity,
  stableLocalProjectIdForRoot,
} from './repoIdentity';
import { repoFolderExists, repoFolderIsGitRepository, repoFolderIsWritable } from './repoFolderAcceptance';

/** Single creation payload for local-only and team-synced projects. */
export interface ProjectCreateInput {
  name: string;
  repos: ProjectCreateRepoInput[];
  primaryRepoId?: string;
  syncMode: 'local-only' | 'team-synced';
  teamInvites?: string[];
  planningDefaults?: ProjectPlanningDefaultsInput;
  gitIntegrationEnabled?: boolean;
  gitlessSingleSessionPerFolder?: boolean;
}

export interface ProjectCreateRepoInput {
  rootPath: string;
  name?: string;
  baseBranch?: string;
}

/** Wizard payload sent from the renderer; normalized on the main process before create. */
export type ProjectCreateWizardPayload = {
  name: string;
  repos: ProjectCreateRepoInput[];
  primaryRootPath?: string;
};

export function isProjectCreateWizardPayload(
  input: ProjectCreateInput | ProjectCreateWizardPayload,
): input is ProjectCreateWizardPayload {
  return !('syncMode' in input);
}

export function normalizeProjectCreateInput(
  input: ProjectCreateInput | ProjectCreateWizardPayload,
): ProjectCreateInput {
  if (isProjectCreateWizardPayload(input)) {
    return prepareLocalProjectCreateInput(input);
  }
  return input;
}

export interface ProjectPlanningDefaultsInput {
  planningAgent?: Agent;
  defaultTaskAgent?: Agent;
  planningModels?: AgentSessionModelDefaults;
  planningAgentYolo?: boolean;
  taskDefaultModels?: AgentSessionModelDefaults;
  defaultTaskAgentYolo?: boolean;
  autoStartSessionOnInProgress?: boolean;
  autoRespondToTrustPrompts?: boolean;
  autoStartWhenUnblocked?: boolean;
  autoCleanupWorkspaceWhenDone?: boolean;
  autoMarkDoneWhenPrMerged?: boolean;
  autoMoveToReviewWhenPrOpen?: boolean;
}

export type ProjectCreateResult =
  | { ok: true; project: import('./types').LocalProject; projectDir: string }
  | { ok: false; error: ProjectCreateError; message?: string };

export type ProjectCreateError =
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'NOT_GIT_REPO'
  | 'DUPLICATE_REPO_PATH'
  | 'PRIMARY_REPO_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'INVITE_INVALID_EMAIL'
  | 'CREATE_FAILED';

export const PROJECT_NAME_MAX_LENGTH = 80;

export type ValidatedLocalProjectCreate = {
  name: string;
  repos: RepoConfig[];
  planningDefaults?: ProjectPlanningDefaultsInput;
  gitIntegrationEnabled?: boolean;
  gitlessSingleSessionPerFolder?: boolean;
};

export function validateProjectName(name: string): 'NAME_REQUIRED' | 'NAME_TOO_LONG' | { ok: true; name: string } {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'NAME_REQUIRED';
  if (trimmed.length > PROJECT_NAME_MAX_LENGTH) return 'NAME_TOO_LONG';
  return { ok: true, name: trimmed };
}

/** User-facing copy for {@link ProjectCreateError} codes from `projects:create`. */
export function projectCreateErrorMessage(
  error: ProjectCreateError,
  message?: string,
): string {
  switch (error) {
    case 'NAME_REQUIRED':
      return 'Enter a project name.';
    case 'NAME_TOO_LONG':
      return `Project name must be ${PROJECT_NAME_MAX_LENGTH} characters or fewer.`;
    case 'NOT_GIT_REPO':
      return 'That folder isn’t a git repository. Run git init first.';
    case 'DUPLICATE_REPO_PATH':
      return 'That repository is already attached.';
    case 'PRIMARY_REPO_REQUIRED':
      return 'Choose a primary repository.';
    case 'AUTH_REQUIRED':
      return 'Sign in to create a team-synced project.';
    case 'INVITE_INVALID_EMAIL':
      return 'Enter a valid email address for each invite.';
    case 'CREATE_FAILED':
      return message?.trim() || 'Could not create the project. Try again.';
    default:
      return message?.trim() || 'Could not create the project. Try again.';
  }
}

/** User-facing copy for folder-picker errors from `project:pickRepoDirectory`. */
export function repoDirectoryPickErrorMessage(error: string): string {
  if (error === 'NOT_GIT_REPO') {
    return 'That folder isn’t a git repository. Run git init first.';
  }
  if (error === 'NOT_WRITABLE') {
    return 'That folder is not writable. Choose a folder you can modify.';
  }
  return error;
}

function resolvePrimaryRootPathForCreate(
  repos: ProjectCreateRepoInput[],
  primaryRootPath?: string,
): string {
  if (repos.length === 1) {
    return path.resolve(repos[0].rootPath);
  }
  const want = primaryRootPath?.trim();
  if (want) {
    return path.resolve(want);
  }
  return path.resolve(repos[0].rootPath);
}

/**
 * Builds a {@link ProjectCreateInput} for local-only creation from wizard state.
 * Assigns {@link primaryRepoId} explicitly when repos are present.
 */
export function prepareLocalProjectCreateInput(params: {
  name: string;
  repos: ProjectCreateRepoInput[];
  primaryRootPath?: string;
}): ProjectCreateInput {
  const nameResult = validateProjectName(params.name);
  const trimmed = nameResult === 'NAME_REQUIRED' || nameResult === 'NAME_TOO_LONG'
    ? params.name.trim()
    : nameResult.name;
  const repoInputs = params.repos ?? [];

  if (repoInputs.length === 0) {
    return {
      name: trimmed,
      repos: [],
      syncMode: 'local-only',
    };
  }

  const primaryRoot = resolvePrimaryRootPathForCreate(repoInputs, params.primaryRootPath);
  const projectId = stableLocalProjectIdForRoot(primaryRoot);
  const primaryRepoId = deriveStablePrimaryRepoIdForProject({
    projectId,
    rootPath: primaryRoot,
  });

  return {
    name: trimmed,
    repos: repoInputs,
    primaryRepoId,
    syncMode: 'local-only',
  };
}

/** Primary repository root used to infer git integration during project create. */
export function resolvePrimaryRepoRootPathForCreate(
  input: Pick<ProjectCreateInput, 'repos' | 'primaryRepoId'>,
): string | null {
  const repoInputs = input.repos ?? [];
  if (repoInputs.length === 0) return null;
  if (repoInputs.length === 1) {
    return path.resolve(repoInputs[0].rootPath);
  }
  const want = input.primaryRepoId?.trim();
  if (!want) return null;
  for (const repo of repoInputs) {
    const resolved = path.resolve(repo.rootPath);
    const projectId = stableLocalProjectIdForRoot(resolved);
    const candidatePrimaryId = deriveStablePrimaryRepoIdForProject({
      projectId,
      rootPath: resolved,
    });
    if (candidatePrimaryId === want) {
      return resolved;
    }
  }
  return null;
}

/** Default git integration for new projects: on when the primary folder is a git repo. */
export async function inferGitIntegrationEnabledForProjectCreate(
  input: ProjectCreateInput,
): Promise<boolean> {
  const primaryRoot = resolvePrimaryRepoRootPathForCreate(input);
  if (!primaryRoot) return true;
  return repoFolderIsGitRepository(primaryRoot);
}

const TEAM_INVITE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalizes invite emails from the wizard (trim, lowercase, dedupe). */
export function normalizeTeamInviteEmails(
  emails: string[],
): { ok: true; emails: string[] } | { ok: false; error: 'INVITE_INVALID_EMAIL' } {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of emails) {
    const lower = raw.trim().toLowerCase();
    if (!lower) continue;
    if (!TEAM_INVITE_EMAIL_RE.test(lower)) {
      return { ok: false, error: 'INVITE_INVALID_EMAIL' };
    }
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return { ok: true, emails: out };
}

/**
 * Assigns stable repo ids for create and orders the primary repo first.
 * {@link deriveStablePrimaryRepoIdForProject} for primary; {@link deriveRepoIdForRootPath} for others.
 */
export function assignRepoIdsForCreate(params: {
  projectId: string;
  repos: ProjectCreateRepoInput[];
  primaryRepoId?: string;
}):
  | { ok: true; repos: RepoConfig[]; primaryRepoId: string }
  | { ok: false; error: 'PRIMARY_REPO_REQUIRED' } {
  if (params.repos.length === 0) {
    return { ok: false, error: 'PRIMARY_REPO_REQUIRED' };
  }

  const resolved = params.repos.map((r) => {
    const rootPath = path.resolve(r.rootPath);
    const base = path.basename(rootPath);
    return {
      rootPath,
      name: (r.name?.trim() || (base && base !== '.' ? base : `repo`)).slice(0, 200),
      baseBranch: (r.baseBranch?.trim() || 'main').slice(0, 200),
      stablePrimaryId: deriveStablePrimaryRepoIdForProject({
        projectId: params.projectId,
        rootPath,
      }),
    };
  });

  let primaryIdx = 0;
  if (params.repos.length === 1) {
    primaryIdx = 0;
  } else if (params.primaryRepoId?.trim()) {
    const want = params.primaryRepoId.trim();
    const idx = resolved.findIndex((r) => r.stablePrimaryId === want);
    if (idx === -1) {
      return { ok: false, error: 'PRIMARY_REPO_REQUIRED' };
    }
    primaryIdx = idx;
  } else {
    return { ok: false, error: 'PRIMARY_REPO_REQUIRED' };
  }

  const primary = resolved[primaryIdx];
  const primaryRepoId = primary.stablePrimaryId;
  const seenExtraIds = new Set<string>([primaryRepoId]);
  const extras: RepoConfig[] = [];

  for (let i = 0; i < resolved.length; i += 1) {
    if (i === primaryIdx) continue;
    const r = resolved[i];
    let salt = '';
    let extraId = deriveRepoIdForRootPath({
      projectId: params.projectId,
      rootPath: r.rootPath,
      salt,
    });
    while (seenExtraIds.has(extraId) || extraId === primaryRepoId) {
      salt = salt ? `${salt}-dup` : 'dup';
      extraId = deriveRepoIdForRootPath({
        projectId: params.projectId,
        rootPath: r.rootPath,
        salt,
      });
    }
    seenExtraIds.add(extraId);
    extras.push({
      id: extraId,
      name: r.name,
      rootPath: r.rootPath,
      baseBranch: r.baseBranch,
    });
  }

  const repos: RepoConfig[] = [
    {
      id: primaryRepoId,
      name: primary.name,
      rootPath: primary.rootPath,
      baseBranch: primary.baseBranch,
    },
    ...extras,
  ];

  return { ok: true, repos, primaryRepoId };
}

export function validateLocalProjectCreateInput(
  input: ProjectCreateInput,
  options?: { isGitRepo: (rootPath: string) => boolean | Promise<boolean> },
): Promise<
  | { ok: true; value: ValidatedLocalProjectCreate & { projectId: string } }
  | { ok: false; error: ProjectCreateError }
> {
  return Promise.resolve().then(async () => {
    if (input.syncMode === 'team-synced') {
      return { ok: false as const, error: 'AUTH_REQUIRED' as const };
    }

    const nameResult = validateProjectName(input.name);
    if (nameResult === 'NAME_REQUIRED') return { ok: false, error: 'NAME_REQUIRED' };
    if (nameResult === 'NAME_TOO_LONG') return { ok: false, error: 'NAME_TOO_LONG' };

    const repoInputs = input.repos ?? [];
    const seenPaths = new Set<string>();
    const normalizedPaths: string[] = [];

    for (const r of repoInputs) {
      if (typeof r.rootPath !== 'string' || !r.rootPath.trim()) {
        return { ok: false, error: 'NOT_GIT_REPO' };
      }
      const resolved = path.resolve(r.rootPath);
      const key = normalizeRepoRootPathForIdentity(resolved);
      if (seenPaths.has(key)) {
        return { ok: false, error: 'DUPLICATE_REPO_PATH' };
      }
      seenPaths.add(key);
      normalizedPaths.push(resolved);

      const isGit = options?.isGitRepo
        ? await options.isGitRepo(resolved)
        : await defaultIsGitRepo(resolved);
      if (!isGit) {
        if (input.gitIntegrationEnabled === false) {
          if (!(await repoFolderExists(resolved))) {
            return { ok: false, error: 'NOT_GIT_REPO' };
          }
          if (!(await repoFolderIsWritable(resolved))) {
            return { ok: false, error: 'NOT_GIT_REPO' };
          }
        } else {
          return { ok: false, error: 'NOT_GIT_REPO' };
        }
      }
    }

    if (repoInputs.length === 0) {
      if (input.primaryRepoId != null && String(input.primaryRepoId).trim() !== '') {
        return { ok: false, error: 'PRIMARY_REPO_REQUIRED' };
      }
      const { randomUUID } = await import('node:crypto');
      return {
        ok: true,
        value: {
          projectId: randomUUID(),
          name: nameResult.name,
          repos: [],
          planningDefaults: input.planningDefaults,
          gitIntegrationEnabled: input.gitIntegrationEnabled,
          gitlessSingleSessionPerFolder: input.gitlessSingleSessionPerFolder,
        },
      };
    }

    const { stableLocalProjectIdForRoot } = await import('./repoIdentity');

    const resolvePrimaryRootForId = (): string | 'PRIMARY_REPO_REQUIRED' => {
      if (repoInputs.length === 1) {
        return normalizedPaths[0];
      }
      const want = input.primaryRepoId?.trim();
      if (!want) {
        return 'PRIMARY_REPO_REQUIRED';
      }
      for (const resolved of normalizedPaths) {
        const candidateProjectId = stableLocalProjectIdForRoot(resolved);
        const candidatePrimaryId = deriveStablePrimaryRepoIdForProject({
          projectId: candidateProjectId,
          rootPath: resolved,
        });
        if (candidatePrimaryId === want) {
          return resolved;
        }
      }
      return 'PRIMARY_REPO_REQUIRED';
    };

    const primaryRootForId = resolvePrimaryRootForId();
    if (primaryRootForId === 'PRIMARY_REPO_REQUIRED') {
      return { ok: false, error: 'PRIMARY_REPO_REQUIRED' };
    }

    const projectId = stableLocalProjectIdForRoot(primaryRootForId);

    const assigned = assignRepoIdsForCreate({
      projectId,
      repos: repoInputs,
      primaryRepoId: input.primaryRepoId,
    });
    if (!assigned.ok) {
      return { ok: false, error: assigned.error };
    }

    return {
      ok: true,
      value: {
        projectId,
        name: nameResult.name,
        repos: assigned.repos,
        planningDefaults: input.planningDefaults,
        gitIntegrationEnabled: input.gitIntegrationEnabled,
        gitlessSingleSessionPerFolder: input.gitlessSingleSessionPerFolder,
      },
    };
  });
}

async function defaultIsGitRepo(rootPath: string): Promise<boolean> {
  const fs = await import('node:fs/promises');
  try {
    await fs.access(path.join(rootPath, '.git'));
    return true;
  } catch {
    return false;
  }
}
