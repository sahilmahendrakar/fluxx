import { Agent, AGENTS } from '../types';
import type { ThemeMode } from '../renderer/theme';
import { useFluxTheme } from '../renderer/FluxThemeProvider';
import { AgentProviderIcon } from './agentProviderIcons';

/** Dark UI — pale fills and high-foreground tints on near-black cards. */
const AGENT_CHIP_STYLES_DARK: Record<Agent, string> = {
  'claude-code':
    'border-violet-500/20 bg-violet-500/[0.08] text-violet-200/90 ring-1 ring-inset ring-violet-500/10',
  codex: 'border-teal-500/20 bg-teal-500/[0.08] text-teal-200/90 ring-1 ring-inset ring-teal-500/10',
  cursor: 'border-amber-500/20 bg-amber-500/[0.08] text-amber-200/90 ring-1 ring-inset ring-amber-500/10',
};

/** Light UI — soft tinted surfaces and saturated text for contrast on white cards. */
const AGENT_CHIP_STYLES_LIGHT: Record<Agent, string> = {
  'claude-code':
    'border-violet-300/80 bg-violet-50 text-violet-900 ring-1 ring-inset ring-violet-200/70',
  codex: 'border-teal-300/80 bg-teal-50 text-teal-950 ring-1 ring-inset ring-teal-200/70',
  cursor: 'border-amber-300/80 bg-amber-50 text-amber-950 ring-1 ring-inset ring-amber-200/70',
};

export function agentChipStyles(agent: Agent, theme: ThemeMode): string {
  return theme === 'light' ? AGENT_CHIP_STYLES_LIGHT[agent] : AGENT_CHIP_STYLES_DARK[agent];
}

/** Dark-mode chip palette (legacy export for call sites that supply their own theme). */
export const AGENT_CHIP_STYLES = AGENT_CHIP_STYLES_DARK;

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
  /** Model / YOLO line from `modelSummaryForTask` (undefined for Codex today). */
  summary?: string;
  variant?: AgentBadgeVariant;
}) {
  const { theme } = useFluxTheme();
  const label = AGENTS.find((a) => a.id === agent)?.label ?? agent;
  const tip = agentBadgeTooltip(label, summary);
  const chip = agentChipStyles(agent, theme);

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
