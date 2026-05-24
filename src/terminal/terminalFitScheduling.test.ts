import { describe, expect, it } from 'vitest';
import {
  containerHasUsableSize,
  MAX_DEFERRED_TERMINAL_FIT_ATTEMPTS,
  shouldDeferTerminalFit,
  shouldImmediateLayoutFit,
} from './terminalFitScheduling';

function mockContainer(width: number, height: number): HTMLElement {
  return { clientWidth: width, clientHeight: height } as HTMLElement;
}

describe('terminalFitScheduling', () => {
  it('containerHasUsableSize requires both dimensions at or above minimum', () => {
    expect(containerHasUsableSize(mockContainer(100, 100))).toBe(true);
    expect(containerHasUsableSize(mockContainer(8, 8))).toBe(true);
    expect(containerHasUsableSize(mockContainer(7, 100))).toBe(false);
    expect(containerHasUsableSize(mockContainer(100, 0))).toBe(false);
  });

  it('shouldDeferTerminalFit retries until max attempts when size is unusable', () => {
    const container = mockContainer(0, 0);
    expect(shouldDeferTerminalFit(container, 0)).toBe(true);
    expect(
      shouldDeferTerminalFit(container, MAX_DEFERRED_TERMINAL_FIT_ATTEMPTS - 1),
    ).toBe(true);
    expect(
      shouldDeferTerminalFit(container, MAX_DEFERRED_TERMINAL_FIT_ATTEMPTS),
    ).toBe(false);
  });

  it('shouldDeferTerminalFit stops when container becomes usable', () => {
    const container = mockContainer(200, 120);
    expect(shouldDeferTerminalFit(container, 0)).toBe(false);
  });

  it('shouldImmediateLayoutFit only on first usable observation', () => {
    const container = mockContainer(200, 120);
    expect(shouldImmediateLayoutFit(false, container)).toBe(true);
    expect(shouldImmediateLayoutFit(true, container)).toBe(false);
    expect(shouldImmediateLayoutFit(false, mockContainer(0, 120))).toBe(false);
  });
});
