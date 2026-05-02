import type {
  Agent,
  AgentSessionModelDefaults,
  CloudProject,
  CloudProjectLocalBinding,
  LocalProject,
} from './types';

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
  };
}

/** Active cloud project for the renderer (Firestore row + local binding + prefs). */
export function hydrateCloudProject(
  summary: {
    id: string;
    name: string;
    ownerId: string;
    memberIds: string[];
    createdAt: string;
  },
  binding: CloudProjectLocalBinding,
): CloudProject {
  const prefs = resolvedPrefsFromBinding(binding);
  return {
    id: summary.id,
    kind: 'cloud',
    name: summary.name,
    ownerId: summary.ownerId,
    memberIds: summary.memberIds,
    createdAt: summary.createdAt,
    rootPath: binding.rootPath,
    ...prefs,
  };
}

/** Default agent for new tasks (local config vs cloud binding prefs). */
export function defaultTaskAgentForProject(project: LocalProject | CloudProject): Agent {
  return project.kind === 'local'
    ? project.defaultTaskAgent
    : (project.defaultTaskAgent ?? CLOUD_BINDING_DEFAULT_TASK_AGENT);
}
