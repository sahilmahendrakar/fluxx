import type { Agent, PlanningSession } from './types';
import { DEFAULT_CURSOR_AGENT_MODEL } from './types';

export type PlanningModelIds = {
  cursor: string;
  'claude-code': string;
  codex: string;
};

export type PlanningStartPayloadInput = {
  agent: Agent;
  modelIds: PlanningModelIds;
  planningYolo: boolean;
};

export type PlanningStartPayload =
  | Agent
  | { agent: Agent; agentModel?: string; agentYolo?: boolean };

export function buildPlanningStartPayload(input: PlanningStartPayloadInput): PlanningStartPayload {
  const { agent, modelIds, planningYolo } = input;
  if (agent === 'codex') {
    return {
      agent,
      agentModel: modelIds.codex.trim(),
      agentYolo: planningYolo,
    };
  }
  if (agent === 'cursor') {
    return {
      agent,
      agentModel: modelIds.cursor.trim() || DEFAULT_CURSOR_AGENT_MODEL,
      agentYolo: planningYolo,
    };
  }
  return {
    agent,
    agentModel: modelIds['claude-code'].trim(),
    agentYolo: planningYolo,
  };
}

export type PlanningResumePayload =
  | { resume: true; sessionId: string; agent: Agent }
  | ({ resume: true; sessionId: string } & {
      agent: Agent;
      agentModel?: string;
      agentYolo?: boolean;
    });

export function buildPlanningResumePayload(
  session: PlanningSession,
  input: Omit<PlanningStartPayloadInput, 'agent'>,
): PlanningResumePayload {
  const base = buildPlanningStartPayload({ ...input, agent: session.agent });
  if (typeof base === 'string') {
    return { resume: true, sessionId: session.id, agent: base };
  }
  return { ...base, resume: true, sessionId: session.id };
}
