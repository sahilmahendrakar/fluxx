import type { ApplyAttachOptions } from './warmAttach';

/**
 * - **owner** — this view is the source of truth for PTY `cols`/`rows`. The
 *   xterm is fitted to the container and `onResize` drives `sessions.resize` /
 *   `shells.resize` / `planning.resize` as wired by the parent.
 * - **mirror** — this view must not change PTY geometry. Warm-attach should not
 *   apply snapshot/attach geometry; replay at local fit (see
 *   `getApplyAttachOptionsForGeometryMode`).
 */
export type TerminalGeometryMode = 'owner' | 'mirror';

/**
 * Returns options for `applyAttachResultToTerminal` given the geometry mode.
 * Mirrors use replay only so a narrow pane does not adopt a full-tab snapshot
 * grid, which would clip the viewport; owners use snapshot + geometry by default.
 */
export function getApplyAttachOptionsForGeometryMode(
  geometryMode: TerminalGeometryMode,
): ApplyAttachOptions {
  if (geometryMode === 'mirror') {
    return {
      applyGeometry: false,
      useSnapshot: false,
    };
  }
  return {};
}

/**
 * After applyAttach completes, owners should `terminal.fit()` so the rendered
 * grid matches the local container and `onResize` updates the real PTY.
 * Mirrors do not need this (they do not own PTY size).
 */
export function shouldPostOwnerFitAfterAttach(
  geometryMode: TerminalGeometryMode,
): boolean {
  return geometryMode === 'owner';
}
