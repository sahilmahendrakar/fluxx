import { Agent, AGENTS } from '../types';

const AGENT_STYLES: Record<Agent, string> = {
  'claude-code': 'bg-purple-900 text-purple-300',
  'codex': 'bg-teal-900 text-teal-300',
  'cursor': 'bg-amber-900 text-amber-300',
};

export default function AgentBadge({ agent }: { agent: Agent }) {
  const label = AGENTS.find((a) => a.id === agent)?.label ?? agent;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${AGENT_STYLES[agent]}`}
    >
      {label}
    </span>
  );
}
