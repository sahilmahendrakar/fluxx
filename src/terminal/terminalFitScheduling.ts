/** Minimum container px before FitAddon can compute cols/rows. */
export const MIN_TERMINAL_CONTAINER_PX = 8;

/** Debounced layout refits while splitters / window drag (ms). */
export const LAYOUT_FIT_DEBOUNCE_MS = 100;

/**
 * Max rAF retries when the container is not yet laid out. ~12 frames ≈ 200ms
 * at 60Hz — enough for flex parents and tab visibility stacks to settle.
 */
export const MAX_DEFERRED_TERMINAL_FIT_ATTEMPTS = 12;

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
