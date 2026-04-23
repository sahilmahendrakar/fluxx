import { Agent, AGENTS } from '../types';

/** Shared chip colors for agent provider (badge, selects, etc.). */
export const AGENT_CHIP_STYLES: Record<Agent, string> = {
  'claude-code':
    'border-violet-500/20 bg-violet-500/[0.08] text-violet-200/90 ring-1 ring-inset ring-violet-500/10',
  codex: 'border-teal-500/20 bg-teal-500/[0.08] text-teal-200/90 ring-1 ring-inset ring-teal-500/10',
  cursor: 'border-amber-500/20 bg-amber-500/[0.08] text-amber-200/90 ring-1 ring-inset ring-amber-500/10',
};

export default function AgentBadge({ agent, title }: { agent: Agent; title?: string }) {
  const label = AGENTS.find((a) => a.id === agent)?.label ?? agent;
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium tracking-tight ${AGENT_CHIP_STYLES[agent]}`}
    >
      {label}
    </span>
  );
}
