/** Marks portaled UI for the agent session prefs flow (popover shell + nested model list). */
export const AGENT_SESSION_PREFS_SURFACE = 'data-flux-agent-session-surface';

export function isAgentSessionPrefsSurfaceTarget(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(`[${AGENT_SESSION_PREFS_SURFACE}]`) != null;
}
