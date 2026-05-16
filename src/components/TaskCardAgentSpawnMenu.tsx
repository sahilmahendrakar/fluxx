import { useRef, useState } from 'react';
import { BotOff } from 'lucide-react';
import type { AgentModelUiKind } from '../agentModelUi';
import { modelSummaryForTask } from '../agentModelUi';
import {
  AGENTS,
  DEFAULT_CURSOR_AGENT_MODEL,
  resolvedCursorAgentModel,
  type Agent,
  type Task,
} from '../types';
import { AgentProviderIcon } from './agentProviderIcons';
import { AGENT_CHIP_STYLES } from './AgentBadge';
import {
  AgentSessionPrefsMenuContent,
  AgentSessionPrefsMenuPortal,
} from './AgentSessionPrefsMenu';

export type TaskAgentSpawnPatch = Partial<Pick<Task, 'agent' | 'agentModel' | 'agentYolo'>>;

/** Chip when no coding agent is assigned (matches task detail “None” styling). */
const UNASSIGNED_AGENT_CHIP =
  'border-zinc-600/40 bg-white/[0.04] text-zinc-400/90 ring-1 ring-inset ring-white/[0.06]';

export function TaskCardAgentSpawnMenu({
  task,
  onPatch,
}: {
  task: Task;
  onPatch: (patch: TaskAgentSpawnPatch) => void;
}) {
  const [prefsOpen, setPrefsOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closePrefsMenu = () => {
    setPrefsOpen(false);
  };

  const selectedAgent = task.agent;
  const cursorModelId =
    task.agent === 'cursor' ? resolvedCursorAgentModel(task) : DEFAULT_CURSOR_AGENT_MODEL;
  const claudeModelId = task.agent === 'claude-code' ? (task.agentModel ?? '').trim() : '';

  const summaryLine = modelSummaryForTask(task);
  const agentLabel =
    selectedAgent == null
      ? 'None'
      : (AGENTS.find((a) => a.id === selectedAgent)?.label ?? selectedAgent);
  const triggerLabel = [agentLabel, summaryLine].filter(Boolean).join(' · ');

  const handleAgentPick = (next: Agent | null) => {
    if (next === selectedAgent) return;
    if (next === null) {
      onPatch({ agent: null });
      return;
    }
    const patch: TaskAgentSpawnPatch = {
      agent: next,
      agentYolo: false,
      agentModel: next === 'cursor' ? DEFAULT_CURSOR_AGENT_MODEL : '',
    };
    onPatch(patch);
  };

  const handleModelPick = (kind: AgentModelUiKind, id: string) => {
    if (kind === 'claude-code') {
      onPatch({ agentModel: id.trim() });
    } else {
      onPatch({ agentModel: id.trim() || DEFAULT_CURSOR_AGENT_MODEL });
    }
  };

  const chip = selectedAgent != null ? AGENT_CHIP_STYLES[selectedAgent] : UNASSIGNED_AGENT_CHIP;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setPrefsOpen((wasOpen) => !wasOpen);
        }}
        aria-label={
          selectedAgent == null
            ? `Choose agent for this task (${triggerLabel || 'no agent'})`
            : `Choose agent and model for this task (${triggerLabel})`
        }
        aria-expanded={prefsOpen}
        aria-haspopup="dialog"
        title={triggerLabel || 'No agent — click to choose'}
        className={`-m-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${chip} outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/20`}
      >
        {selectedAgent != null ? (
          <AgentProviderIcon agent={selectedAgent} className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <BotOff className="h-3.5 w-3.5 text-zinc-500/90" strokeWidth={2} aria-hidden />
        )}
      </button>
      <AgentSessionPrefsMenuPortal
        open={prefsOpen}
        anchorRef={anchorRef}
        dropdownRef={dropdownRef}
        onClose={closePrefsMenu}
        ariaLabel="Task agent and model"
      >
        <AgentSessionPrefsMenuContent
          selectedAgent={selectedAgent}
          claudeModelId={claudeModelId}
          cursorModelId={cursorModelId}
          agentYolo={task.agentYolo === true}
          onPickAgent={handleAgentPick}
          onPickModel={handleModelPick}
          onToggleYolo={(next) => onPatch({ agentYolo: next })}
          taskSpawnSurface
        />
      </AgentSessionPrefsMenuPortal>
    </>
  );
}
