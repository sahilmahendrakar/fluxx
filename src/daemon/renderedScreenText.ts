import type { Terminal as HeadlessTerminal } from '@xterm/headless';

const BOTTOM_LINE_COUNT = 40;

/** Collapses all runs of whitespace to a single ASCII space (for prompt matching). */
export function collapseWhitespaceRuns(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Bottom `maxLines` lines of the **active** xterm buffer (normal or alternate),
 * joined and passed through {@link collapseWhitespaceRuns}.
 */
export function collapsedBottomScreenText(
  terminal: HeadlessTerminal,
  maxLines: number = BOTTOM_LINE_COUNT,
): string {
  const buf = terminal.buffer.active;
  const n = buf.length;
  if (n === 0) {
    return '';
  }
  const start = Math.max(0, n - maxLines);
  const parts: string[] = [];
  for (let y = start; y < n; y += 1) {
    const line = buf.getLine(y);
    if (line) {
      parts.push(line.translateToString(true));
    }
  }
  return collapseWhitespaceRuns(parts.join('\n'));
}
