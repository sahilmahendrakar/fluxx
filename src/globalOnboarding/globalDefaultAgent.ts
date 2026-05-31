import type { ProjectPlanningDefaultsInput } from '../projectCreate';
import type { ActiveProjectKey, Agent, CloudProjectLocalBinding } from '../types';
import type { GlobalOnboardingStateV1 } from './types';

const AGENTS: Agent[] = ['claude-code', 'codex', 'cursor'];

function isAgent(value: unknown): value is Agent {
  return typeof value === 'string' && (AGENTS as string[]).includes(value);
}

/** Global default agent from onboarding (`app-state.json`). */
export function readGlobalOnboardingDefaultAgent(snapshot: {
  globalOnboarding?: GlobalOnboardingStateV1;
}): Agent | undefined {
  const agent = snapshot.globalOnboarding?.selectedAgent;
  return isAgent(agent) ? agent : undefined;
}

/**
 * Fills planning/task agent on create when the payload omits them.
 * Explicit project-specific defaults win.
 */
export function mergeProjectPlanningDefaultsWithGlobal(
  input: ProjectPlanningDefaultsInput | undefined,
  globalAgent: Agent | undefined,
): ProjectPlanningDefaultsInput | undefined {
  if (!globalAgent) return input;
  const merged: ProjectPlanningDefaultsInput = { ...(input ?? {}) };
  if (merged.planningAgent === undefined) {
    merged.planningAgent = globalAgent;
  }
  if (merged.defaultTaskAgent === undefined) {
    merged.defaultTaskAgent = globalAgent;
  }
  return merged;
}

/**
 * Binding prefs patch for a new cloud project when agents are not set yet.
 * Returns undefined when both agents are already stored on the binding.
 */
export function cloudBindingAgentPrefsIfUnset(
  binding: CloudProjectLocalBinding | null | undefined,
  globalAgent: Agent,
): { planningAgent: Agent; defaultTaskAgent: Agent } | undefined {
  const hasPlanning = isAgent(binding?.planningAgent);
  const hasTask = isAgent(binding?.defaultTaskAgent);
  if (hasPlanning && hasTask) return undefined;
  return {
    planningAgent: hasPlanning ? binding!.planningAgent! : globalAgent,
    defaultTaskAgent: hasTask ? binding!.defaultTaskAgent! : globalAgent,
  };
}

export type SyncGlobalOnboardingAgentDeps = {
  activeProjectKey: ActiveProjectKey | null;
  setCloudPrefs: (
    projectId: string,
    prefs: { planningAgent: Agent; defaultTaskAgent: Agent },
  ) => Promise<void>;
  setLocalPlanningAgent: (agent: Agent) => Promise<void>;
  setLocalDefaultTaskAgent: (agent: Agent) => Promise<void>;
};

/** Applies the globally selected agent to the active project, when one is open. */
export async function syncGlobalOnboardingAgentToActiveProject(
  agent: Agent,
  deps: SyncGlobalOnboardingAgentDeps,
): Promise<{ ok: true } | { error: string }> {
  const key = deps.activeProjectKey;
  if (!key) return { ok: true };
  try {
    if (key.kind === 'cloud') {
      await deps.setCloudPrefs(key.id, {
        planningAgent: agent,
        defaultTaskAgent: agent,
      });
      return { ok: true };
    }
    await deps.setLocalPlanningAgent(agent);
    await deps.setLocalDefaultTaskAgent(agent);
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}
