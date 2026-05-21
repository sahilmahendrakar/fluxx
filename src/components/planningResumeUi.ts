import { AGENTS, type Agent, type PlanningSession } from '../types';

export function planningAgentSupportsCliResume(agent: Agent): boolean {
  return agent === 'cursor' || agent === 'claude-code' || agent === 'codex';
}

/** Live PTY row still in the daemon (running or after exit, before tab dismiss). */
export function planningSessionHasWarmTerminal(session: PlanningSession): boolean {
  return (
    session.status === 'running' ||
    session.status === 'stopped' ||
    session.status === 'error'
  );
}

/** Cold (`interrupted`) or warm (`stopped` / `error`) sessions the CLI can resume. */
export function isPlanningSessionResumable(session: PlanningSession): boolean {
  if (!planningAgentSupportsCliResume(session.agent)) return false;
  return (
    session.status === 'interrupted' ||
    session.status === 'stopped' ||
    session.status === 'error'
  );
}

/** @deprecated Use {@link isPlanningSessionResumable}. */
export const isPlanningSessionColdResumable = isPlanningSessionResumable;

/** Tooltip for the Resume button (captured id vs bare `--resume`). */
export function planningResumeButtonTitle(agentConversationId?: string): string {
  if (agentConversationId?.trim()) {
    return 'Continue the CLI session using the captured resume id (--resume <id>)';
  }
  return 'Continue the CLI session from disk (--resume)';
}

export function planningResumeStateHeading(session: PlanningSession): string {
  if (session.status === 'interrupted') return 'Planning session interrupted';
  return 'Planning session ended';
}

export function planningResumeStateDetail(session: PlanningSession): string {
  if (session.status === 'interrupted') {
    return 'Fluxx can continue this assistant from the saved planning directory.';
  }
  return 'The assistant exited. You can resume the CLI conversation or start a new session.';
}

export function planningTabLabel(s: PlanningSession, index: number): string {
  const agent = AGENTS.find((a) => a.id === s.agent)?.label ?? s.agent;
  return `Plan ${index + 1} · ${agent}`;
}

export function planningResumeDismissTitle(): string {
  return 'Dismiss this resume offer (archives the saved session)';
}

/** @deprecated Use {@link planningResumeDismissTitle}. */
export const planningInterruptedDismissTitle = planningResumeDismissTitle;
