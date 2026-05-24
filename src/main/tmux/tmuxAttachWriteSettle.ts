/** Minimum pause after a tmux attach-bridge write before the next queued write. */
export const TMUX_ATTACH_WRITE_SETTLE_BASE_MS = 40;

/** Extra ms per UTF-8 byte (large bracketed pastes need more drain time). */
export const TMUX_ATTACH_WRITE_SETTLE_PER_BYTE_MS = 0.15;

/** Upper bound so automation does not stall on very large prompts. */
export const TMUX_ATTACH_WRITE_SETTLE_MAX_MS = 500;

/**
 * Delay before resolving {@link TerminalRuntimeManager.writeSessionAwait} for
 * tmux-backed sessions. The attach PTY (`tmux attach`) buffers input separately
 * from the agent pane; `setImmediate` alone lets a follow-up `\r` overtake a
 * large bracketed paste and leave text in the input without submitting.
 */
export function tmuxAttachWriteSettleMs(data: string): number {
  const bytes = Buffer.byteLength(data, 'utf8');
  const scaled = TMUX_ATTACH_WRITE_SETTLE_BASE_MS + bytes * TMUX_ATTACH_WRITE_SETTLE_PER_BYTE_MS;
  return Math.min(TMUX_ATTACH_WRITE_SETTLE_MAX_MS, Math.round(scaled));
}
