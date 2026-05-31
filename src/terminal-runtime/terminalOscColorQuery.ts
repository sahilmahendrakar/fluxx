import type { ResolvedAppearance } from '../theme/appearance';
import { terminalSurfaceHex } from '../terminal/xtermTheme';

/** Cursor agent / claude-code probe with `\e]11;?\a` or ST-terminated variants. */
const OSC_DYNAMIC_COLOR_QUERY =
  /\x1b\]1([01]);(\?(?:\x07|\x1b\\)|(?:\x07|\x1b\\))/;

function hexToOscRgb(hex: string): string {
  const h = hex.replace(/^#/, '');
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `rgb:${r}${r}/${g}${g}/${b}${b}`;
}

function foregroundHexForAppearance(appearance: ResolvedAppearance): string {
  return appearance === 'light' ? '#27272a' : '#d4d4d8';
}

/** OSC 10/11 *response* bytes (BEL-terminated) injected to PTY stdin. */
export function buildTerminalAppearanceResponseSequence(
  appearance: ResolvedAppearance,
): string {
  const fg = hexToOscRgb(foregroundHexForAppearance(appearance));
  const bg = hexToOscRgb(terminalSurfaceHex(appearance));
  return `\x1b]10;${fg}\x07\x1b]11;${bg}\x07`;
}

export function ptyOutputContainsOscDynamicColorQuery(data: string): boolean {
  return OSC_DYNAMIC_COLOR_QUERY.test(data);
}

/**
 * When a TUI writes OSC 10/11 queries to stdout, answer on PTY stdin with the
 * current Flux appearance so Cursor agent picks light/dark correctly.
 */
export function respondToTerminalColorQueriesIfNeeded(
  data: string,
  appearance: ResolvedAppearance,
  write: (response: string) => void,
): boolean {
  if (!ptyOutputContainsOscDynamicColorQuery(data)) return false;
  const response = buildTerminalAppearanceResponseSequence(appearance);
  write(response);
  return true;
}
