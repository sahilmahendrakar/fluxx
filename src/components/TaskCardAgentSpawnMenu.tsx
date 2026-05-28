import { useRef, useState } from 'react';
import { BotOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
  'border-border bg-muted/60 text-muted-foreground ring-1 ring-inset ring-border/60';

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
  const codexModelId = task.agent === 'codex' ? (task.agentModel ?? '').trim() : '';

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
    if (kind === 'claude-code' || kind === 'codex') {
      onPatch({ agentModel: id.trim() });
    } else {
      onPatch({ agentModel: id.trim() || DEFAULT_CURSOR_AGENT_MODEL });
    }
  };

  const chip = selectedAgent != null ? AGENT_CHIP_STYLES[selectedAgent] : UNASSIGNED_AGENT_CHIP;

  return (
    <>
      <Button
        ref={anchorRef}
        type="button"
        variant="outline"
        size="icon"
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
        className={cn(
          '-m-0.5 size-6 shrink-0 rounded-md border hover:brightness-110',
          chip,
        )}
      >
        {selectedAgent != null ? (
          <AgentProviderIcon agent={selectedAgent} className="size-3.5" aria-hidden />
        ) : (
          <BotOff className="size-3.5 text-muted-foreground" strokeWidth={2} aria-hidden />
        )}
      </Button>
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
          codexModelId={codexModelId}
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
