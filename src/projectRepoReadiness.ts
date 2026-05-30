import type {
  CloudRepoBindingOverview,
  CloudSharedRepo,
  RepoConfig,
  RepoPathStatus,
} from './types';
import { repoDisplayLabel } from './repoIdentity';

export type ProjectRepoReadinessKind =
  | 'ready'
  | 'no_repos'
  | 'unbound'
  | 'invalid_path';

export interface ProjectRepoReadinessIssue {
  repoId: string;
  label: string;
  pathStatus: Exclude<RepoPathStatus, 'valid'>;
}

export interface ProjectRepoReadiness {
  kind: ProjectRepoReadinessKind;
  /** Primary copy for banners and disabled-action hints. */
  message: string;
  /** Short label for the settings CTA button. */
  ctaLabel: string;
  unboundRepoLabels?: string[];
  invalidPathIssues?: ProjectRepoReadinessIssue[];
}

export interface ResolveProjectRepoReadinessInput {
  projectKind: 'local' | 'cloud';
  configuredRepos: RepoConfig[];
  sharedRepos: CloudSharedRepo[];
  cloudBindingOverview?: CloudRepoBindingOverview | null;
  /** When true, the primary shared repo has no machine binding (single-repo cloud). */
  cloudNeedsPrimaryBinding?: boolean;
  /** Per-repo disk status from `project:getRepoManagementStates`. */
  repoPathById?: Record<string, RepoPathStatus> | null;
  /** When false, `not_git` folders are acceptable if they exist (gitless mode). */
  gitIntegrationEnabled?: boolean;
}

function sharedRepoLabel(sr: CloudSharedRepo): string {
  return sr.name?.trim() || sr.id;
}

function listUnboundSharedRepos(input: ResolveProjectRepoReadinessInput): string[] {
  const { sharedRepos, cloudBindingOverview, cloudNeedsPrimaryBinding } = input;
  if (sharedRepos.length === 0) return [];

  if (sharedRepos.length === 1) {
    return cloudNeedsPrimaryBinding ? [sharedRepoLabel(sharedRepos[0])] : [];
  }

  if (!cloudBindingOverview) return [];

  const labels: string[] = [];
  for (const sr of sharedRepos) {
    const status = cloudBindingOverview[sr.id];
    if (!status || status.kind === 'missing_binding') {
      labels.push(sharedRepoLabel(sr));
    }
  }
  return labels;
}

function listInvalidPathIssues(input: ResolveProjectRepoReadinessInput): ProjectRepoReadinessIssue[] {
  const issues: ProjectRepoReadinessIssue[] = [];
  const seen = new Set<string>();
  const gitEnabled = input.gitIntegrationEnabled !== false;

  const pushIssue = (repoId: string, label: string, pathStatus: 'missing' | 'not_git') => {
    if (seen.has(repoId)) return;
    seen.add(repoId);
    issues.push({ repoId, label, pathStatus });
  };

  const overview = input.cloudBindingOverview;
  if (overview) {
    for (const sr of input.sharedRepos) {
      const status = overview[sr.id];
      if (status?.kind === 'bound' && status.pathStatus !== 'valid') {
        if (!gitEnabled && status.pathStatus === 'not_git') {
          continue;
        }
        pushIssue(sr.id, sharedRepoLabel(sr), status.pathStatus);
      }
    }
  }

  const pathById = input.repoPathById;
  if (pathById) {
    for (const repo of input.configuredRepos) {
      const pathStatus = pathById[repo.id];
      if (pathStatus === 'missing') {
        pushIssue(repo.id, repoDisplayLabel(repo), pathStatus);
      } else if (pathStatus === 'not_git') {
        if (gitEnabled) {
          pushIssue(repo.id, repoDisplayLabel(repo), pathStatus);
        }
      }
    }
  }

  return issues;
}

function hasZeroRepos(input: ResolveProjectRepoReadinessInput): boolean {
  if (input.projectKind === 'cloud') {
    return input.sharedRepos.length === 0 && input.configuredRepos.length === 0;
  }
  return input.configuredRepos.length === 0;
}

function buildNoReposReadiness(projectKind: 'local' | 'cloud'): ProjectRepoReadiness {
  if (projectKind === 'cloud') {
    return {
      kind: 'no_repos',
      message:
        'This team project has no shared repositories yet. Add one in project settings so you and teammates can bind local clones.',
      ctaLabel: 'Open project settings',
    };
  }
  return {
    kind: 'no_repos',
    message:
      'No repositories are attached to this project. Add a repository in project settings to create task workspaces and run sessions.',
    ctaLabel: 'Open project settings',
  };
}

function buildUnboundReadiness(labels: string[]): ProjectRepoReadiness {
  const quoted =
    labels.length === 1
      ? labels[0]
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
  return {
    kind: 'unbound',
    message:
      labels.length === 1
        ? `Bind a local folder for ${quoted} in project settings to run task sessions on this machine.`
        : `Bind local folders for ${quoted} in project settings to run task sessions on this machine.`,
    ctaLabel: 'Open project settings',
    unboundRepoLabels: labels,
  };
}

function buildInvalidPathReadiness(issues: ProjectRepoReadinessIssue[]): ProjectRepoReadiness {
  const first = issues[0];
  const label = first.label;
  const message =
    issues.length > 1
      ? 'One or more repository paths are missing or not git repositories. Fix them in project settings.'
      : first.pathStatus === 'missing'
        ? `The folder for ${label} no longer exists on this machine. Rebind it in project settings.`
        : `The folder for ${label} is not a git repository. Choose a valid clone in project settings.`;
  return {
    kind: 'invalid_path',
    message,
    ctaLabel: 'Open project settings',
    invalidPathIssues: issues,
  };
}

/**
 * Derives whether repo-dependent board/task actions should be enabled.
 * Returns `ready` for healthy single- and multi-repo projects.
 */
export function resolveProjectRepoReadiness(
  input: ResolveProjectRepoReadinessInput,
): ProjectRepoReadiness {
  if (hasZeroRepos(input)) {
    return buildNoReposReadiness(input.projectKind);
  }

  const unboundLabels = listUnboundSharedRepos(input);
  if (unboundLabels.length > 0) {
    return buildUnboundReadiness(unboundLabels);
  }

  const invalidIssues = listInvalidPathIssues(input);
  if (invalidIssues.length > 0) {
    return buildInvalidPathReadiness(invalidIssues);
  }

  return {
    kind: 'ready',
    message: '',
    ctaLabel: 'Open project settings',
  };
}

/** True when task sessions, worktrees, and branch discovery require a healthy repo. */
export function projectRepoActionsBlocked(readiness: ProjectRepoReadiness): boolean {
  return readiness.kind !== 'ready';
}

export const READY_PROJECT_REPO_READINESS: ProjectRepoReadiness = {
  kind: 'ready',
  message: '',
  ctaLabel: 'Open project settings',
};
