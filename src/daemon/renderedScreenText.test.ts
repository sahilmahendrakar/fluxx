import { describe, expect, it } from 'vitest';
import { Terminal as HeadlessTerminal } from '@xterm/headless';
import { collapseWhitespaceRuns, collapsedBottomScreenText } from './renderedScreenText';

describe('renderedScreenText', () => {
  it('collapseWhitespaceRuns squashes internal whitespace', () => {
    expect(collapseWhitespaceRuns('  a \n\t b  ')).toBe('a b');
  });

  it('collapsedBottomScreenText reads tail of active buffer', async () => {
    const term = new HeadlessTerminal({ cols: 40, rows: 5, scrollback: 50, allowProposedApi: true });
    term.write('line0\r\n');
    term.write('line1\r\n');
    term.write('TRUST Is this a project you created or one you trust HERE');
    await new Promise<void>((r) => {
      term.write('', () => r());
    });
    const t = collapsedBottomScreenText(term, 10);
    expect(t).toContain('TRUST');
    expect(t).toContain('you created');
  });
});
