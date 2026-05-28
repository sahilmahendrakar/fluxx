import { Agent, AGENTS } from '../types';
import { AgentProviderIcon } from './agentProviderIcons';

/** Shared chip colors for agent provider (badge, selects, etc.). */
export const AGENT_CHIP_STYLES: Record<Agent, string> = {
  'claude-code':
    'border-violet-500/30 bg-violet-500/10 text-violet-800 ring-1 ring-inset ring-violet-500/15 dark:border-violet-500/20 dark:bg-violet-500/[0.08] dark:text-violet-200/90 dark:ring-violet-500/10',
  codex:
    'border-teal-500/30 bg-teal-500/10 text-teal-900 ring-1 ring-inset ring-teal-500/15 dark:border-teal-500/20 dark:bg-teal-500/[0.08] dark:text-teal-200/90 dark:ring-teal-500/10',
  cursor:
    'border-amber-500/35 bg-amber-500/10 text-amber-900 ring-1 ring-inset ring-amber-500/15 dark:border-amber-500/20 dark:bg-amber-500/[0.08] dark:text-amber-200/90 dark:ring-amber-500/10',
};

export type AgentBadgeVariant = 'label' | 'icon';

function agentBadgeTooltip(label: string, summary: string | undefined): string {
  return [label, summary].filter(Boolean).join(' · ');
}

export default function AgentBadge({
  agent,
  summary,
  variant = 'label',
}: {
  agent: Agent;
  /** Model / YOLO line from `modelSummaryForTask`. */
  summary?: string;
  variant?: AgentBadgeVariant;
}) {
  const label = AGENTS.find((a) => a.id === agent)?.label ?? agent;
  const tip = agentBadgeTooltip(label, summary);
  const chip = AGENT_CHIP_STYLES[agent];

  if (variant === 'icon') {
    return (
      <span
        title={tip}
        aria-label={tip}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${chip}`}
      >
        <AgentProviderIcon agent={agent} className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <span
      title={tip}
      className={`inline-flex max-w-full items-center truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium tracking-tight ${chip}`}
    >
      {label}
    </span>
  );
}
