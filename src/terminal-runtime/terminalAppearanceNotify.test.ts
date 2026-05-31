import { describe, expect, it } from 'vitest';
import {
  buildTerminalAppearanceNotifyBundle,
  buildTerminalAppearanceNotifySequence,
} from './terminalAppearanceNotify';

describe('buildTerminalAppearanceNotifySequence', () => {
  it('emits DEC 997 light notification for light appearance', () => {
    expect(buildTerminalAppearanceNotifySequence('light')).toBe('\x1b[?997;2n');
  });

  it('emits DEC 997 dark notification for dark appearance', () => {
    expect(buildTerminalAppearanceNotifySequence('dark')).toBe('\x1b[?997;1n');
  });

  it('bundle includes DEC 997 and OSC 11 response', () => {
    const bundle = buildTerminalAppearanceNotifyBundle('light');
    expect(bundle.startsWith('\x1b[?997;2n')).toBe(true);
    expect(bundle).toContain('\x1b]11;rgb:fafa/f8f8/f5f5\x07');
  });
});
