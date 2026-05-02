import type { Agent, AgentSessionModelDefaults } from './types';
import { DEFAULT_CURSOR_AGENT_MODEL } from './types';

export type ProjectAgentDefaultsSource = {
  planningModels?: AgentSessionModelDefaults;
  planningAgentYolo?: boolean;
  taskDefaultModels?: AgentSessionModelDefaults;
  defaultTaskAgentYolo?: boolean;
};

export function resolvedPlanningModelForSpawn(
  src: ProjectAgentDefaultsSource,
  agent: Agent,
  payloadModel: string | undefined,
): string | undefined {
  if (payloadModel !== undefined) {
    return payloadModel;
  }
  if (agent === 'claude-code') {
    const m = src.planningModels?.['claude-code'];
    return typeof m === 'string' ? m : undefined;
  }
  if (agent === 'cursor') {
    const m = src.planningModels?.cursor;
    if (typeof m === 'string' && m.trim()) return m.trim();
    return DEFAULT_CURSOR_AGENT_MODEL;
  }
  return undefined;
}

export function resolvedPlanningYoloForSpawn(
  src: ProjectAgentDefaultsSource,
  payloadYolo: boolean | undefined,
): boolean {
  if (payloadYolo !== undefined) return payloadYolo;
  return src.planningAgentYolo === true;
}

export function resolvedTaskModelForCreate(
  src: ProjectAgentDefaultsSource,
  agent: Agent,
  explicitModel: string | undefined,
): string | undefined {
  if (explicitModel !== undefined) {
    return explicitModel;
  }
  if (agent === 'claude-code') {
    const m = src.taskDefaultModels?.['claude-code'];
    return typeof m === 'string' ? m : undefined;
  }
  if (agent === 'cursor') {
    const m = src.taskDefaultModels?.cursor;
    if (typeof m === 'string' && m.trim()) return m.trim();
    return DEFAULT_CURSOR_AGENT_MODEL;
  }
  return undefined;
}

export function resolvedTaskYoloForCreate(
  src: ProjectAgentDefaultsSource,
  explicitYolo: boolean | undefined,
): boolean | undefined {
  if (explicitYolo !== undefined) return explicitYolo;
  if (src.defaultTaskAgentYolo === true) return true;
  return undefined;
}

export function taskRowModelFields(
  agent: Agent,
  model: string | undefined,
): { agentModel?: string; agentYolo?: boolean } {
  const out: { agentModel?: string; agentYolo?: boolean } = {};
  if (agent === 'claude-code') {
    const t = (model ?? '').trim();
    if (t) out.agentModel = t;
  } else if (agent === 'cursor') {
    const t = (model ?? '').trim() || DEFAULT_CURSOR_AGENT_MODEL;
    out.agentModel = t;
  }
  return out;
}

export function attachTaskYolo(
  fields: { agentModel?: string; agentYolo?: boolean },
  yolo: boolean | undefined,
): { agentModel?: string; agentYolo?: boolean } {
  if (yolo === true) {
    return { ...fields, agentYolo: true };
  }
  return fields;
}

/** Model + YOLO fields for a new task row after applying project defaults. */
export function mergedTaskCreateAgentFields(
  src: ProjectAgentDefaultsSource,
  agent: Agent,
  explicitModel?: string,
  explicitYolo?: boolean,
): { agentModel?: string; agentYolo?: boolean } {
  const model = resolvedTaskModelForCreate(src, agent, explicitModel);
  const yolo = resolvedTaskYoloForCreate(src, explicitYolo);
  return attachTaskYolo(taskRowModelFields(agent, model), yolo);
}
