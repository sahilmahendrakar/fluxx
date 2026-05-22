import type { Agent, PlanningSession, Session } from '../types';

/** Live task rows first; append cold-resume synthetics not already live (stable order). */
export function mergeTaskSessionsWithColdResume(
  live: Session[],
  cold: Session[],
): Session[] {
  const liveIds = new Set(live.map((s) => s.id));
  const merged = [...live];
  for (const row of cold) {
    if (!liveIds.has(row.id)) {
      merged.push(row);
    }
  }
  return merged;
}

export type PlanningStartPayload = {
  agent?: Agent;
  agentModel?: string;
  agentYolo?: boolean;
  resume?: boolean;
  sessionId?: string;
  initialPrompt?: string;
};

function isPlanningAgent(value: unknown): value is Agent {
  return value === 'claude-code' || value === 'codex' || value === 'cursor';
}

/** Parse `planning:start` IPC payload (agent-only legacy or structured object). */
export function parsePlanningStartPayload(payload: unknown): PlanningStartPayload | null {
  if (isPlanningAgent(payload)) {
    return { agent: payload };
  }
  if (!payload || typeof payload !== 'object') return null;
  const o = payload as {
    agent?: unknown;
    agentModel?: unknown;
    agentYolo?: unknown;
    resume?: unknown;
    sessionId?: unknown;
    initialPrompt?: unknown;
  };
  const resume = o.resume === true;
  const sessionId =
    typeof o.sessionId === 'string' && o.sessionId.trim()
      ? o.sessionId.trim()
      : undefined;
  const agentModel = typeof o.agentModel === 'string' ? o.agentModel : undefined;
  const agentYolo = typeof o.agentYolo === 'boolean' ? o.agentYolo : undefined;
  const initialPrompt =
    typeof o.initialPrompt === 'string' ? o.initialPrompt : undefined;

  if (resume) {
    if (isPlanningAgent(o.agent)) {
      return { agent: o.agent, agentModel, agentYolo, resume: true, sessionId };
    }
    if (sessionId) {
      return { agentModel, agentYolo, resume: true, sessionId };
    }
    return null;
  }

  if (!isPlanningAgent(o.agent)) return null;
  return { agent: o.agent, agentModel, agentYolo, initialPrompt };
}

/** Live planning rows first; append cold-resume synthetics not already live (stable order). */
export function mergePlanningSessionsWithColdResume(
  live: PlanningSession[],
  cold: PlanningSession[],
): PlanningSession[] {
  const liveIds = new Set(live.map((s) => s.id));
  const merged = [...live];
  for (const row of cold) {
    if (!liveIds.has(row.id)) {
      merged.push(row);
    }
  }
  return merged;
}
