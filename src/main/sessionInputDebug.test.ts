import { describe, expect, it } from 'vitest';
import { describeSessionInputForLog, wrapAsXtermBracketedPaste } from './sessionInputDebug';

describe('wrapAsXtermBracketedPaste', () => {
  it('wraps with xterm CSI 200 / 201 paste markers', () => {
    expect(wrapAsXtermBracketedPaste('a\nb')).toBe('\x1b[200~a\nb\x1b[201~');
  });
});

describe('describeSessionInputForLog', () => {
  it('escapes CR, LF, tab, ESC and other C0 controls', () => {
    expect(describeSessionInputForLog('a\rb\nc\t\x1b[0m')).toBe('a\\rb\\nc\\t\\x1b[0m');
    expect(describeSessionInputForLog('\x00\x7f')).toBe('\\x00\\x7f');
  });

  it('truncates long payloads', () => {
    const s = 'x'.repeat(700);
    const r = describeSessionInputForLog(s, 100);
    expect(r).toContain('…<truncated');
    expect(r.length).toBeLessThan(s.length);
  });
});
