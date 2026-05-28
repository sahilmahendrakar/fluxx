/** Marks portaled UI for the agent session prefs flow (popover shell + nested model list). */
export const AGENT_SESSION_PREFS_SURFACE = 'data-flux-agent-session-surface';

/** Stacking for task-card / planning agent prefs (above board cards, below app chrome modals). */
export const AGENT_SESSION_PREFS_BACKDROP_Z = 5600;
export const AGENT_SESSION_PREFS_MENU_Z = 5610;
/** Agent select + model list portaled inside the prefs menu. */
export const AGENT_SESSION_PREFS_NESTED_Z = 5620;

/** Tailwind class for {@link AGENT_SESSION_PREFS_NESTED_Z} (must stay in sync). */
export const AGENT_SESSION_PREFS_NESTED_Z_CLASS = 'z-[5620]';

export function isAgentSessionPrefsSurfaceTarget(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(`[${AGENT_SESSION_PREFS_SURFACE}]`) != null;
}
