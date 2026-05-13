import type {
  Agent,
  AgentSessionModelDefaults,
  CloudProject,
  CloudProjectLocalBinding,
  CloudRepoMachineBinding,
  CloudSharedRepo,
  LocalProject,
} from './types';
import {
  migrateLegacyCloudBinding,
  primaryMachineBinding,
} from './cloudLocalBindingMigration';
import {
  deriveStablePrimaryRepoIdForProject,
  normalizeRepoRootPathForIdentity,
  repoRootBasename,
} from './repoIdentity';

export { primaryRootPathFromCloudBinding } from './cloudLocalBindingMigration';

/** Matches `ProjectStore` defaults for the same preference keys. */
export const CLOUD_BINDING_DEFAULT_PLANNING_AGENT: Agent = 'claude-code';
export const CLOUD_BINDING_DEFAULT_TASK_AGENT: Agent = 'claude-code';

export interface ResolvedCloudBindingPrefs {
  planningAgent: Agent;
  defaultTaskAgent: Agent;
  planningModels?: AgentSessionModelDefaults;
  planningAgentYolo?: boolean;
  taskDefaultModels?: AgentSessionModelDefaults;
  defaultTaskAgentYolo?: boolean;
  autoStartSessionOnInProgress: boolean;
  autoStartWhenUnblocked: boolean;
  autoCleanupWorkspaceWhenDone: boolean;
  autoMarkDoneWhenPrMerged: boolean;
  autoMoveToReviewWhenPrOpen: boolean;
}

function isAgent(value: unknown): value is Agent {
  return (
    value === 'claude-code' || value === 'codex' || value === 'cursor'
  );
}

/** Preference slice with defaults aligned to `LocalProject`. */
export function resolvedPrefsFromBinding(
  binding: CloudProjectLocalBinding | null | undefined,
): ResolvedCloudBindingPrefs {
  return {
    planningAgent: isAgent(binding?.planningAgent)
      ? binding.planningAgent
      : CLOUD_BINDING_DEFAULT_PLANNING_AGENT,
    defaultTaskAgent: isAgent(binding?.defaultTaskAgent)
      ? binding.defaultTaskAgent
      : CLOUD_BINDING_DEFAULT_TASK_AGENT,
    ...(binding?.planningModels && Object.keys(binding.planningModels).length > 0
      ? { planningModels: binding.planningModels }
      : {}),
    ...(binding?.planningAgentYolo === true ? { planningAgentYolo: true } : {}),
    ...(binding?.taskDefaultModels && Object.keys(binding.taskDefaultModels).length > 0
      ? { taskDefaultModels: binding.taskDefaultModels }
      : {}),
    ...(binding?.defaultTaskAgentYolo === true ? { defaultTaskAgentYolo: true } : {}),
    autoStartSessionOnInProgress: binding?.autoStartSessionOnInProgress === true,
    autoStartWhenUnblocked: binding?.autoStartWhenUnblocked === true,
    autoCleanupWorkspaceWhenDone:
      binding?.autoCleanupWorkspaceWhenDone === true ||
      binding?.autoDeleteTaskWhenDone === true,
    autoMarkDoneWhenPrMerged: binding?.autoMarkDoneWhenPrMerged === true,
    autoMoveToReviewWhenPrOpen: binding?.autoMoveToReviewWhenPrOpen === true,
  };
}

function sharedReposForHydration(
  projectId: string,
  summaryRepos: CloudSharedRepo[] | undefined,
  primary: { rootPath: string },
): CloudSharedRepo[] {
  if (summaryRepos && summaryRepos.length > 0) return summaryRepos;
  const id = deriveStablePrimaryRepoIdForProject({
    projectId,
    rootPath: primary.rootPath,
  });
  return [
    {
      id,
      name: repoRootBasename(primary.rootPath),
      baseBranch: 'main',
    },
  ];
}

function repoMachineBindingsForHydration(
  sharedRepos: CloudSharedRepo[],
  binding: CloudProjectLocalBinding,
): Partial<Record<string, CloudRepoMachineBinding>> {
  const rb = binding.repoBindings;
  const out: Partial<Record<string, CloudRepoMachineBinding>> = {};
  for (const repo of sharedRepos) {
    const entry = rb?.[repo.id];
    if (entry) out[repo.id] = entry;
  }
  return out;
}

/**
 * Stable id of the shared repo whose local clone is {@link CloudProject.rootPath}
 * (primary workspace). Falls back to the first {@link CloudProject.sharedRepos} entry.
 */
export function resolveCloudPrimaryRepoId(
  project: Pick<CloudProject, 'rootPath' | 'sharedRepos' | 'repoMachineBindings'>,
): string | undefined {
  const primaryPath = normalizeRepoRootPathForIdentity(project.rootPath);
  for (const sr of project.sharedRepos) {
    const machine = project.repoMachineBindings[sr.id];
    if (machine && normalizeRepoRootPathForIdentity(machine.rootPath) === primaryPath) {
      return sr.id;
    }
  }
  return project.sharedRepos[0]?.id;
}

/** Active cloud project for the renderer (Firestore row + local binding + prefs). */
export function hydrateCloudProject(
  summary: {
    id: string;
    name: string;
    ownerId: string;
    memberIds: string[];
    createdAt: string;
    repos?: CloudSharedRepo[];
  },
  binding: CloudProjectLocalBinding,
): CloudProject {
  const prefs = resolvedPrefsFromBinding(binding);
  const migrated = migrateLegacyCloudBinding(summary.id, binding);
  const primary = primaryMachineBinding(summary.id, migrated, summary.repos);
  if (!primary) {
    throw new Error('[hydrateCloudProject] binding has no primary repo path');
  }
  const sharedRepos = sharedReposForHydration(summary.id, summary.repos, primary);
  return {
    id: summary.id,
    kind: 'cloud',
    name: summary.name,
    ownerId: summary.ownerId,
    memberIds: summary.memberIds,
    createdAt: summary.createdAt,
    rootPath: primary.rootPath,
    sharedRepos,
    repoMachineBindings: repoMachineBindingsForHydration(sharedRepos, migrated),
    ...prefs,
  };
}

/** Default agent for new tasks (local config vs cloud binding prefs). */
export function defaultTaskAgentForProject(project: LocalProject | CloudProject): Agent {
  return project.kind === 'local'
    ? project.defaultTaskAgent
    : (project.defaultTaskAgent ?? CLOUD_BINDING_DEFAULT_TASK_AGENT);
}
