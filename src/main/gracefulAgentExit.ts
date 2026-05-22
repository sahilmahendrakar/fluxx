import type { Agent } from '../types';

/** Ctrl+C — ask interactive agent CLIs to shut down and print resume hints. */
export const TERMINAL_INTERRUPT_CHAR = '\x03';

/**
 * Cursor / Claude Code often treat the first Ctrl+C as "cancel current turn";
 * a second Ctrl+C exits the CLI and prints the `--resume` hint we parse.
 */
export const GRACEFUL_QUIT_AGENT_INTERRUPT_COUNT = 2;

/** Pause between Ctrl+C sends so the PTY can render the resume line. */
export const GRACEFUL_QUIT_INTERRUPT_GAP_MS = 350;

/** Agents whose CLIs may emit `--resume` conversation ids on graceful exit. */
export function agentSupportsGracefulQuitCapture(agent: Agent): boolean {
  return agent === 'cursor' || agent === 'claude-code';
}

export function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
