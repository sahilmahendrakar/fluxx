import { describe, expect, it, vi } from 'vitest';
import {
  buildTerminalAppearanceResponseSequence,
  ptyOutputContainsOscDynamicColorQuery,
  respondToTerminalColorQueriesIfNeeded,
} from './terminalOscColorQuery';

describe('terminalOscColorQuery', () => {
  it('detects OSC 11 query with BEL terminator', () => {
    expect(ptyOutputContainsOscDynamicColorQuery('\x1b]11;?\x07')).toBe(true);
  });

  it('detects OSC 10 query with ST terminator', () => {
    expect(ptyOutputContainsOscDynamicColorQuery('\x1b]10;?\x1b\\')).toBe(true);
  });

  it('builds BEL-terminated OSC 10/11 response for light mode', () => {
    const seq = buildTerminalAppearanceResponseSequence('light');
    expect(seq).toContain('\x1b]10;rgb:2727/2727/2a2a\x07');
    expect(seq).toContain('\x1b]11;rgb:fafa/f8f8/f5f5\x07');
  });

  it('writes response when agent probes stdout', () => {
    const write = vi.fn();
    const ok = respondToTerminalColorQueriesIfNeeded('\x1b]11;?\x07', 'light', write);
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0]).toContain('rgb:fafa/f8f8/f5f5');
  });
});
