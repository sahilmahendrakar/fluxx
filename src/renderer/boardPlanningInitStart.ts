import { PLANNING_INIT_INITIAL_PROMPT } from '../planningInitPrompt';
import {
  resolvedPlanningModelForSpawn,
  resolvedPlanningYoloForSpawn,
} from '../projectAgentDefaults';
import type { Agent, PlanningSession, Project } from '../types';

function defaultPlanningAgent(project: Project): Agent {
  return project.kind === 'local' ? project.planningAgent : (project.planningAgent ?? 'claude-code');
}

export function buildPlanningStartPayload(
  project: Project,
  opts?: { initialPrompt?: string },
):
  | Agent
  | {
      agent: Agent;
      agentModel?: string;
      agentYolo?: boolean;
      initialPrompt?: string;
    } {
  const agent = defaultPlanningAgent(project);
  const agentModel = resolvedPlanningModelForSpawn(project, agent, undefined);
  const agentYolo = resolvedPlanningYoloForSpawn(project, undefined);
  const initialPrompt = opts?.initialPrompt?.trim();

  if (agent === 'codex') {
    return {
      agent,
      agentYolo,
      ...(initialPrompt ? { initialPrompt } : {}),
    };
  }
  if (agent === 'cursor') {
    return {
      agent,
      agentModel,
      agentYolo,
      ...(initialPrompt ? { initialPrompt } : {}),
    };
  }
  return {
    agent,
    agentModel: agentModel ?? '',
    agentYolo,
    ...(initialPrompt ? { initialPrompt } : {}),
  };
}

export async function startBoardPlanningInitSession(
  project: Project,
): Promise<PlanningSession | { error: string }> {
  const planningApi = window.electronAPI?.planning;
  if (!planningApi) {
    return { error: 'Planning assistant is not available in this build.' };
  }
  const result = await planningApi.start(
    buildPlanningStartPayload(project, { initialPrompt: PLANNING_INIT_INITIAL_PROMPT }),
  );
  if (result && typeof result === 'object' && 'error' in result) {
    const err = result as { error: string; message?: string };
    return { error: err.message ?? err.error ?? 'Failed to start planning session' };
  }
  return result as PlanningSession;
}
