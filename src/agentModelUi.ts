import type { Task } from './types';
import { claudeCodeExplicitModel, resolvedCursorAgentModel } from './types';

export type AgentModelUiKind = 'cursor' | 'claude-code' | 'codex';

export type AgentModelPreset = { id: string; label: string };

/** Shown in the task detail model picker for Claude Code (`claude --model`). */
export const CLAUDE_MODEL_PRESETS: AgentModelPreset[] = [
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

/**
 * Shown in the task detail model picker for Codex (`codex --model`).
 * Reasoning effort is a separate `model_reasoning_effort` setting, so these
 * ids carry no effort suffix.
 */
export const CODEX_MODEL_PRESETS: AgentModelPreset[] = [
  { id: 'gpt-5.6-sol', label: 'GPT 5.6 Sol' },
  { id: 'gpt-5.6-terra', label: 'GPT 5.6 Terra' },
  { id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna' },
];

/** Shown in the task detail model picker for Cursor Agent (`agent --model`). */
export const CURSOR_MODEL_PRESETS: AgentModelPreset[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'claude-fable-5-thinking-high', label: 'Fable 5 Thinking' },
  { id: 'claude-opus-5-thinking-high', label: 'Opus 5 Thinking' },
  { id: 'claude-sonnet-5-thinking-high', label: 'Sonnet 5 Thinking' },
  { id: 'gpt-5.6-sol-high', label: 'GPT 5.6 Sol' },
  { id: 'composer-2.5', label: 'Composer 2.5' },
];

const EXTRAS_STORAGE_KEY = 'flux.agentModelExtras.v1';

type ExtrasFile = {
  v: 1;
  cursor?: AgentModelPreset[];
  'claude-code'?: AgentModelPreset[];
  codex?: AgentModelPreset[];
};

function presetIds(kind: AgentModelUiKind): Set<string> {
  const list =
    kind === 'cursor'
      ? CURSOR_MODEL_PRESETS
      : kind === 'codex'
        ? CODEX_MODEL_PRESETS
        : CLAUDE_MODEL_PRESETS;
  return new Set(list.map((p) => p.id));
}

function builtInList(kind: AgentModelUiKind): AgentModelPreset[] {
  if (kind === 'cursor') return CURSOR_MODEL_PRESETS;
  if (kind === 'codex') return CODEX_MODEL_PRESETS;
  return CLAUDE_MODEL_PRESETS;
}

export function readAgentModelExtras(): Record<AgentModelUiKind, AgentModelPreset[]> {
  try {
    const raw = localStorage.getItem(EXTRAS_STORAGE_KEY);
    if (!raw) return { cursor: [], 'claude-code': [], codex: [] };
    const parsed = JSON.parse(raw) as ExtrasFile;
    if (!parsed || parsed.v !== 1) return { cursor: [], 'claude-code': [], codex: [] };
    const norm = (arr: unknown): AgentModelPreset[] => {
      if (!Array.isArray(arr)) return [];
      const out: AgentModelPreset[] = [];
      for (const row of arr) {
        if (!row || typeof row !== 'object') continue;
        const id = typeof (row as { id: unknown }).id === 'string' ? (row as { id: string }).id.trim() : '';
        const label =
          typeof (row as { label: unknown }).label === 'string'
            ? (row as { label: string }).label.trim()
            : '';
        if (!id) continue;
        out.push({ id, label: label || id });
      }
      return out;
    };
    return {
      cursor: norm(parsed.cursor),
      'claude-code': norm(parsed['claude-code']),
      codex: norm(parsed.codex),
    };
  } catch {
    return { cursor: [], 'claude-code': [], codex: [] };
  }
}

export function writeAgentModelExtras(data: Record<AgentModelUiKind, AgentModelPreset[]>): void {
  const payload: ExtrasFile = {
    v: 1,
    cursor: data.cursor,
    'claude-code': data['claude-code'],
    codex: data.codex,
  };
  try {
    localStorage.setItem(EXTRAS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function appendAgentModelExtra(kind: AgentModelUiKind, entry: AgentModelPreset): boolean {
  const id = entry.id.trim();
  if (!id) return false;
  const label = entry.label.trim() || id;
  const all = readAgentModelExtras();
  const preset = presetIds(kind);
  if (preset.has(id)) return false;
  const existing = all[kind];
  if (existing.some((e) => e.id === id)) return false;
  const next = { ...all, [kind]: [...existing, { id, label }] };
  writeAgentModelExtras(next);
  return true;
}

export function mergedModelChoices(kind: AgentModelUiKind): AgentModelPreset[] {
  const extras = readAgentModelExtras()[kind];
  const seen = new Set<string>();
  const out: AgentModelPreset[] = [];
  for (const p of builtInList(kind)) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  for (const e of extras) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/** Presets + extras, plus the current task id if it is not already listed (legacy / hand-edited). */
export function choicesForPicker(kind: AgentModelUiKind, currentId: string): AgentModelPreset[] {
  const merged = mergedModelChoices(kind);
  const id = currentId.trim();
  if (!id) return merged;
  if (merged.some((p) => p.id === id)) return merged;
  return [{ id, label: id }, ...merged];
}

export function labelForModelId(kind: AgentModelUiKind, modelId: string): string {
  const id = modelId.trim();
  if (!id && (kind === 'claude-code' || kind === 'codex')) return 'Default';
  if (!id) return 'Auto';
  for (const p of choicesForPicker(kind, modelId)) {
    if (p.id === id) return p.label;
  }
  return id;
}

/** Tooltip / card subtitle for the active model. */
export function modelSummaryForTask(task: Pick<Task, 'agent' | 'agentModel' | 'agentYolo'>): string | undefined {
  if (task.agent == null) return undefined;
  if (task.agent === 'cursor') {
    const id = resolvedCursorAgentModel(task);
    return `Model: ${labelForModelId('cursor', id)}${task.agentYolo ? ' · YOLO' : ''}`;
  }
  if (task.agent === 'claude-code') {
    const id = claudeCodeExplicitModel(task);
    const base = id ? labelForModelId('claude-code', id) : 'Default';
    return `Model: ${base}${task.agentYolo ? ' · skip permissions' : ''}`;
  }
  if (task.agent === 'codex') {
    const id = (task.agentModel ?? '').trim();
    const base = id ? labelForModelId('codex', id) : 'Default';
    return `Model: ${base}${task.agentYolo ? ' · YOLO' : ''}`;
  }
  return undefined;
}
