import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import type { ResolvedAppearance } from '../theme/appearance';
import { buildTerminalAppearanceResponseSequence } from './terminalOscColorQuery';

/**
 * DEC 997 color-scheme report Cursor Agent listens for on stdin (`use-theme-detection`).
 * `997;2` → light, `997;1` → dark.
 */
export function buildTerminalAppearanceNotifySequence(
  appearance: ResolvedAppearance,
): string {
  const mode = appearance === 'light' ? '2' : '1';
  return `\x1b[?997;${mode}n`;
}

/** Notify + OSC fallback so running agent sessions re-probe after appearance toggle. */
export function buildTerminalAppearanceNotifyBundle(
  appearance: ResolvedAppearance,
): string {
  return buildTerminalAppearanceNotifySequence(appearance) + buildTerminalAppearanceResponseSequence(appearance);
}

/** Push sequences to a tmux pane TTY (agent runs inside the session, not the attach bridge). */
export function notifyAppearanceToTmuxPane(tmuxSessionName: string, sequence: string): void {
  const result = spawnSync(
    'tmux',
    ['display-message', '-p', '-t', tmuxSessionName, '#{pane_tty}'],
    { encoding: 'utf8' },
  );
  const tty = result.stdout?.trim();
  if (!tty) return;
  try {
    fs.writeFileSync(tty, sequence);
  } catch {
    // pane exited or tty unavailable
  }
}
