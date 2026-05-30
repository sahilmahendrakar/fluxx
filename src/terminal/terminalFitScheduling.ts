/** Minimum container px before FitAddon can compute cols/rows. */
export const MIN_TERMINAL_CONTAINER_PX = 8;

/** Debounced layout refits while splitters / window drag (ms). */
export const LAYOUT_FIT_DEBOUNCE_MS = 100;

/**
 * Max rAF retries when the container is not yet laid out. ~12 frames ≈ 200ms
 * at 60Hz — enough for flex parents and tab visibility stacks to settle.
 */
export const MAX_DEFERRED_TERMINAL_FIT_ATTEMPTS = 12;

/**
 * Extra rAF passes after a usable fit when the container px look stable but
 * flex parents, stacked visibility tabs, or WebGL/font metrics may still
 * settle. Visibility flips use the higher minimum.
 */
export const MAX_SETTLING_FIT_ATTEMPTS = 6;
export const MIN_SETTLING_FIT_ATTEMPTS = 2;
export const MIN_VISIBILITY_SETTLE_FIT_ATTEMPTS = 4;

export type ContainerSize = { width: number; height: number };

export function readContainerSize(container: HTMLElement): ContainerSize {
  return { width: container.clientWidth, height: container.clientHeight };
}

export function containerHasUsableSize(
  el: HTMLElement,
  minPx = MIN_TERMINAL_CONTAINER_PX,
): boolean {
  return el.clientWidth >= minPx && el.clientHeight >= minPx;
}

/** True when another animation frame should retry fit before giving up. */
export function shouldDeferTerminalFit(
  container: HTMLElement,
  attemptCount: number,
  maxAttempts = MAX_DEFERRED_TERMINAL_FIT_ATTEMPTS,
): boolean {
  return (
    !containerHasUsableSize(container) && attemptCount < maxAttempts
  );
}

/**
 * ResizeObserver can fire once with a stable size before fonts/layout finish.
 * Immediate (non-debounced) refit is appropriate for the first usable observation
 * or when a pane becomes visible again; ongoing drag uses debounced layout fit.
 */
export function shouldImmediateLayoutFit(
  layoutFitEstablished: boolean,
  container: HTMLElement,
): boolean {
  return !layoutFitEstablished && containerHasUsableSize(container);
}

export interface SettlingFitOptions {
  minAttempts?: number;
  maxAttempts?: number;
}

/**
 * Keep refitting across animation frames when the container is still zero-sized,
 * its px changed since the last pass, or we have not yet reached `minAttempts`
 * usable fits (covers visibility stacks that report stable clientWidth/Height
 * before the final geometry).
 */
export function shouldContinueSettlingFit(
  attemptCount: number,
  sizeBeforeFit: ContainerSize,
  container: HTMLElement,
  options: SettlingFitOptions = {},
): boolean {
  const minAttempts = options.minAttempts ?? MIN_SETTLING_FIT_ATTEMPTS;
  const maxAttempts = options.maxAttempts ?? MAX_SETTLING_FIT_ATTEMPTS;

  if (!containerHasUsableSize(container)) {
    return attemptCount < MAX_DEFERRED_TERMINAL_FIT_ATTEMPTS;
  }
  if (attemptCount >= maxAttempts) {
    return false;
  }
  const after = readContainerSize(container);
  if (after.width !== sizeBeforeFit.width || after.height !== sizeBeforeFit.height) {
    return true;
  }
  return attemptCount + 1 < minAttempts;
}
