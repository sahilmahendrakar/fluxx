import { describe, expect, it } from 'vitest';
import {
  containerHasUsableSize,
  MAX_DEFERRED_TERMINAL_FIT_ATTEMPTS,
  MAX_SETTLING_FIT_ATTEMPTS,
  MIN_SETTLING_FIT_ATTEMPTS,
  MIN_VISIBILITY_SETTLE_FIT_ATTEMPTS,
  readContainerSize,
  shouldContinueSettlingFit,
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

  it('readContainerSize mirrors clientWidth and clientHeight', () => {
    expect(readContainerSize(mockContainer(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
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

  it('shouldContinueSettlingFit retries while container is unusable', () => {
    const container = mockContainer(0, 0);
    expect(
      shouldContinueSettlingFit(0, readContainerSize(container), container),
    ).toBe(true);
    expect(
      shouldContinueSettlingFit(
        MAX_DEFERRED_TERMINAL_FIT_ATTEMPTS,
        readContainerSize(container),
        container,
      ),
    ).toBe(false);
  });

  it('shouldContinueSettlingFit runs minimum passes even when px are stable', () => {
    const container = mockContainer(800, 400);
    const size = readContainerSize(container);
    expect(
      shouldContinueSettlingFit(0, size, container, {
        minAttempts: MIN_SETTLING_FIT_ATTEMPTS,
      }),
    ).toBe(true);
    expect(
      shouldContinueSettlingFit(MIN_SETTLING_FIT_ATTEMPTS - 1, size, container, {
        minAttempts: MIN_SETTLING_FIT_ATTEMPTS,
      }),
    ).toBe(false);
  });

  it('shouldContinueSettlingFit keeps going when container px change between frames', () => {
    let width = 400;
    const container = {
      get clientWidth() {
        return width;
      },
      clientHeight: 300,
    } as HTMLElement;
    const sizeBefore = readContainerSize(container);
    width = 800;
    expect(shouldContinueSettlingFit(0, sizeBefore, container)).toBe(true);
  });

  it('shouldContinueSettlingFit uses a higher minimum for visibility settle', () => {
    const container = mockContainer(900, 500);
    const size = readContainerSize(container);
    expect(
      shouldContinueSettlingFit(
        MIN_VISIBILITY_SETTLE_FIT_ATTEMPTS - 2,
        size,
        container,
        { minAttempts: MIN_VISIBILITY_SETTLE_FIT_ATTEMPTS },
      ),
    ).toBe(true);
    expect(
      shouldContinueSettlingFit(
        MIN_VISIBILITY_SETTLE_FIT_ATTEMPTS - 1,
        size,
        container,
        { minAttempts: MIN_VISIBILITY_SETTLE_FIT_ATTEMPTS },
      ),
    ).toBe(false);
  });

  it('shouldContinueSettlingFit stops at maxAttempts', () => {
    const container = mockContainer(640, 480);
    const size = readContainerSize(container);
    expect(
      shouldContinueSettlingFit(MAX_SETTLING_FIT_ATTEMPTS - 1, size, container, {
        maxAttempts: MAX_SETTLING_FIT_ATTEMPTS,
      }),
    ).toBe(false);
  });
});
