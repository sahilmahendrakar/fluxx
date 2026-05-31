import path from 'node:path';
import type { FluxAutomationInvokeResponse } from './AutomationHttpServer';
import type { FluxAutomationHost } from './fluxAutomationRuns';
import { githubCliRepoService } from './githubCliRepoService';
import type {
  GithubRepoAttachMetadata,
  GithubRepoCreateInput,
  GithubRepoOnboardingErrorCode,
  RepoAttachAutomationOp,
} from '../githubRepoOnboarding/types';
import {
  findDuplicateLocalRepoByPath,
  githubFieldsFromAttachMetadata,
  parseGithubNameWithOwner,
  validateGithubRepoAttachForLocal,
  DUPLICATE_LOCAL_PATH_MESSAGE,
} from '../githubRepoOnboarding/githubRepoAttach';
import type {
  AutomationBridgeRepoAttachAtPathPayload,
  AutomationBridgeRepoAttachAtPathResult,
} from '../rendererAutomationBridge';
import {
  isRetryableRepoAttachCode,
  type RepoAttachCliSuccess,
} from '../githubRepoOnboarding/repoAttachCliTypes';
import { validateRepoFolderForBinding } from '../repoFolderAcceptance';
import { backfillRepoIdentities } from './ProjectStore';

export function isRepoAttachAutomationOp(op: string): op is RepoAttachAutomationOp {
  return (
    op === 'repo.addLocal' ||
    op === 'repo.github.add' ||
    op === 'repo.github.createAndAttach'
  );
}

function attachFailure(
  error: string,
  code?: string,
  extra?: {
    retryable?: boolean;
    github?: { nameWithOwner: string; url?: string };
    githubRepoCreated?: boolean;
  },
): FluxAutomationInvokeResponse {
  return {
    ok: false,
    error,
    ...(code !== undefined ? { code } : {}),
    ...(extra?.retryable !== undefined ? { retryable: extra.retryable } : {}),
    ...(extra?.github !== undefined ? { github: extra.github } : {}),
    ...(extra?.githubRepoCreated !== undefined
      ? { githubRepoCreated: extra.githubRepoCreated }
      : {}),
  };
}

function ghFailureToAttach(
  code: GithubRepoOnboardingErrorCode,
  message: string,
  extra?: {
    github?: { nameWithOwner: string; url?: string };
    githubRepoCreated?: boolean;
  },
): FluxAutomationInvokeResponse {
  return attachFailure(message, code, {
    retryable: isRetryableRepoAttachCode(code),
    ...extra,
  });
}

function successFromAttach(
  data: AutomationBridgeRepoAttachAtPathResult,
  githubRepoCreated: boolean,
): RepoAttachCliSuccess {
  const slug =
    data.githubOwner && data.githubName
      ? {
          owner: data.githubOwner,
          name: data.githubName,
          nameWithOwner: data.nameWithOwner ?? `${data.githubOwner}/${data.githubName}`,
        }
      : data.nameWithOwner
        ? (() => {
            const parsed = parseGithubNameWithOwner(data.nameWithOwner);
            if (!parsed) return undefined;
            return {
              owner: parsed.owner,
              name: parsed.repo,
              nameWithOwner: data.nameWithOwner,
            };
          })()
        : undefined;
  return {
    repoId: data.repoId,
    rootPath: data.rootPath,
    ...(slug
      ? {
          github: {
            ...slug,
            ...(data.githubUrl ? { url: data.githubUrl } : {}),
          },
        }
      : {}),
    githubRepoCreated,
    newlyAttached: data.newlyAttached,
  };
}

async function attachAtPathOnHost(
  h: FluxAutomationHost,
  payload: AutomationBridgeRepoAttachAtPathPayload,
  githubRepoCreated: boolean,
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open', code: 'NO_ACTIVE_PROJECT' };
  }

  if (active.kind === 'local') {
    const rootPath = path.resolve(payload.rootPath);
    const gitEnabled = active.project.gitIntegrationEnabled !== false;
    const validated = await validateRepoFolderForBinding(rootPath, gitEnabled);
    if (!validated.ok) {
      if (validated.error === 'MISSING') {
        return attachFailure('That folder does not exist.', 'MISSING_PATH');
      }
      if (validated.error === 'NOT_WRITABLE') {
        return attachFailure('That folder is not writable.', 'NOT_WRITABLE');
      }
      return attachFailure('That folder is not a git repository.', 'NOT_GIT_REPO');
    }

    const { repos: existingRepos } = backfillRepoIdentities({
      projectId: active.project.id,
      primaryRootPath: active.project.rootPath,
      repos: active.project.repos,
    });

    if (payload.github) {
      const dup = validateGithubRepoAttachForLocal({
        repos: existingRepos,
        input: { rootPath: validated.resolved, github: payload.github },
      });
      if (!dup.ok) {
        return attachFailure(dup.message, 'DUPLICATE_REPO');
      }
    } else if (findDuplicateLocalRepoByPath(existingRepos, validated.resolved)) {
      return attachFailure(DUPLICATE_LOCAL_PATH_MESSAGE, 'DUPLICATE_REPO');
    }

    const ghFields = payload.github
      ? githubFieldsFromAttachMetadata(payload.github)
      : null;
    try {
      const repos = await h.projectStore.addRepoAt(active.projectDir, validated.resolved, {
        ...(ghFields
          ? {
              githubOwner: ghFields.githubOwner,
              githubName: ghFields.githubName,
              name: payload.github.nameWithOwner.split('/').pop(),
              baseBranch: payload.github.defaultBranch,
            }
          : {}),
      });
      const added = repos.find((r) => path.resolve(r.rootPath) === validated.resolved);
      if (!added) {
        return attachFailure('Repository was added but could not be resolved in config.');
      }
      const slug = ghFields
        ? {
            owner: ghFields.githubOwner,
            name: ghFields.githubName,
            nameWithOwner: payload.github!.nameWithOwner,
            ...(ghFields.remoteUrl ? { url: ghFields.remoteUrl } : {}),
          }
        : undefined;
      return {
        ok: true,
        data: successFromAttach(
          {
            repoId: added.id,
            rootPath: validated.resolved,
            newlyAttached: true,
            ...(slug
              ? {
                  githubOwner: slug.owner,
                  githubName: slug.name,
                  nameWithOwner: slug.nameWithOwner,
                  githubUrl: slug.url,
                }
              : {}),
          },
          githubRepoCreated,
        ),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return attachFailure(message, 'ATTACH_FAILED');
    }
  }

  const result = await h.bridge.request<AutomationBridgeRepoAttachAtPathResult>(
    'repo.attachAtPath',
    active.activeKey,
    payload,
  );
  if (!result.ok) {
    return h.bridgeFailureToInvoke(result);
  }
  return { ok: true, data: successFromAttach(result.data, githubRepoCreated) };
}

function parseRootPath(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const pathValue = typeof p.path === 'string' ? p.path : typeof p.rootPath === 'string' ? p.rootPath : '';
  const trimmed = pathValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCloneDir(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const dir =
    typeof p.cloneDir === 'string'
      ? p.cloneDir
      : typeof p.destination === 'string'
        ? p.destination
        : '';
  const trimmed = dir.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseRepoSlug(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const repo = typeof p.repo === 'string' ? p.repo.trim() : '';
  return repo.length > 0 ? repo : null;
}

function parseGithubCreateInput(payload: unknown): GithubRepoCreateInput | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  const visibility = p.visibility;
  if (!name) return null;
  if (visibility !== 'public' && visibility !== 'private' && visibility !== 'internal') {
    return null;
  }
  return {
    name,
    visibility,
    ...(typeof p.owner === 'string' && p.owner.trim() ? { owner: p.owner.trim() } : {}),
    ...(typeof p.description === 'string' ? { description: p.description } : {}),
  };
}

function githubMetadataFromSlug(
  repoSlug: string,
  url?: string,
  defaultBranch?: string,
): GithubRepoAttachMetadata {
  return {
    nameWithOwner: repoSlug,
    ...(url?.trim() ? { url: url.trim() } : {}),
    ...(defaultBranch?.trim() ? { defaultBranch: defaultBranch.trim() } : {}),
  };
}

async function ensureGithubFlowsAllowed(
  h: FluxAutomationHost,
): Promise<FluxAutomationInvokeResponse | null> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open', code: 'NO_ACTIVE_PROJECT' };
  }
  if (active.kind === 'local' && active.project.gitIntegrationEnabled === false) {
    return attachFailure(
      'GitHub clone and create require git integration to be enabled for this project.',
      'GIT_INTEGRATION_DISABLED',
    );
  }
  if (active.kind === 'cloud') {
    const binding = h.bindingStore.get(active.activeKey.id);
    if (binding?.gitIntegrationEnabled === false) {
      return attachFailure(
        'GitHub clone and create require git integration to be enabled for this project.',
        'GIT_INTEGRATION_DISABLED',
      );
    }
  }
  return null;
}

export async function runRepoAttachAutomation(
  h: FluxAutomationHost,
  op: RepoAttachAutomationOp,
  payload: unknown,
): Promise<FluxAutomationInvokeResponse> {
  if (op === 'repo.addLocal') {
    const rootPath = parseRootPath(payload);
    if (!rootPath) {
      return attachFailure('repo.addLocal requires { path }', 'INVALID_INPUT');
    }
    return attachAtPathOnHost(h, { rootPath }, false);
  }

  const blocked = await ensureGithubFlowsAllowed(h);
  if (blocked) return blocked;

  if (op === 'repo.github.add') {
    const repo = parseRepoSlug(payload);
    const cloneDir = parseCloneDir(payload);
    if (!repo || !cloneDir) {
      return attachFailure(
        'repo.github.add requires { repo, cloneDir } (cloneDir is the final clone destination folder)',
        'INVALID_INPUT',
      );
    }
    const destination = path.resolve(cloneDir);
    const destCheck = await githubCliRepoService.checkCloneDestination(destination);
    if (!destCheck.ok) {
      return ghFailureToAttach(destCheck.code, destCheck.message);
    }
    const cloneResult = await githubCliRepoService.cloneRepo({
      repo,
      destination,
    });
    if (!cloneResult.ok) {
      return ghFailureToAttach(cloneResult.code, cloneResult.message);
    }
    return attachAtPathOnHost(
      h,
      {
        rootPath: cloneResult.destination,
        github: githubMetadataFromSlug(cloneResult.nameWithOwner),
      },
      false,
    );
  }

  const createInput = parseGithubCreateInput(payload);
  const cloneDir = parseCloneDir(payload);
  if (!createInput || !cloneDir) {
    return attachFailure(
      'repo.github.createAndAttach requires { name, visibility, cloneDir } (cloneDir is the final clone destination folder)',
      'INVALID_INPUT',
    );
  }
  const destination = path.resolve(cloneDir);
  const destCheck = await githubCliRepoService.checkCloneDestination(destination);
  if (!destCheck.ok) {
    return ghFailureToAttach(destCheck.code, destCheck.message);
  }
  const createResult = await githubCliRepoService.createRepo(createInput);
  if (!createResult.ok) {
    return ghFailureToAttach(createResult.code, createResult.message);
  }
  const repoSlug = createResult.nameWithOwner;
  const cloneResult = await githubCliRepoService.cloneRepo({
    repo: repoSlug,
    destination,
  });
  if (!cloneResult.ok) {
    return ghFailureToAttach(cloneResult.code, cloneResult.message, {
      github: { nameWithOwner: repoSlug, ...(createResult.url ? { url: createResult.url } : {}) },
      githubRepoCreated: true,
    });
  }
  return attachAtPathOnHost(
    h,
    {
      rootPath: cloneResult.destination,
      github: githubMetadataFromSlug(repoSlug, createResult.url),
    },
    true,
  );
}
