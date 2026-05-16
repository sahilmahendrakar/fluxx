import type { ApplyAttachOptions } from './warmAttach';

export type TerminalGeometryOwnership = 'owner' | 'mirror';
export type TerminalFitMode = 'container' | 'fixedSnapshot';
export type TerminalInteractionMode = 'interactive' | 'readOnly';

export interface TerminalViewPolicy {
  geometryOwnership: TerminalGeometryOwnership;
  fitMode: TerminalFitMode;
  interactionMode: TerminalInteractionMode;
}

export const OWNER_TERMINAL_VIEW_POLICY: TerminalViewPolicy = {
  geometryOwnership: 'owner',
  fitMode: 'container',
  interactionMode: 'interactive',
};

export const MIRROR_TERMINAL_VIEW_POLICY: TerminalViewPolicy = {
  geometryOwnership: 'mirror',
  fitMode: 'fixedSnapshot',
  interactionMode: 'readOnly',
};

export const INTERACTIVE_MIRROR_TERMINAL_VIEW_POLICY: TerminalViewPolicy = {
  geometryOwnership: 'mirror',
  fitMode: 'fixedSnapshot',
  interactionMode: 'interactive',
};

/**
 * Renderer attach state always prefers snapshots. Mirrors differ from owners
 * only in local geometry and PTY resize ownership, not in restore source.
 */
export function getApplyAttachOptionsForViewPolicy(
  policy: TerminalViewPolicy,
): ApplyAttachOptions {
  if (policy.fitMode === 'fixedSnapshot') {
    return {
      applyGeometry: true,
      useSnapshot: true,
    };
  }
  return {};
}

/**
 * Container-fit owners refit after attach so `onResize` can update the PTY.
 * Fixed-snapshot mirrors keep the PTY-owned grid and must not refit.
 */
export function shouldPostAttachFit(policy: TerminalViewPolicy): boolean {
  return policy.geometryOwnership === 'owner' && policy.fitMode === 'container';
}

export function terminalShouldAutoFit(policy: TerminalViewPolicy): boolean {
  return policy.fitMode === 'container';
}

export function terminalShouldForwardInput(policy: TerminalViewPolicy): boolean {
  return policy.interactionMode === 'interactive';
}

export function terminalOwnsPtyGeometry(policy: TerminalViewPolicy): boolean {
  return policy.geometryOwnership === 'owner';
}
