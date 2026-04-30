import { describe, expect, it } from 'vitest';
import {
  getApplyAttachOptionsForGeometryMode,
  shouldPostOwnerFitAfterAttach,
} from './terminalGeometryPolicy';

describe('terminalGeometryPolicy', () => {
  it('owner uses default apply options (no mirror overrides)', () => {
    expect(getApplyAttachOptionsForGeometryMode('owner')).toEqual({});
  });

  it('mirror disables snapshot geometry and attach grid for local replay', () => {
    expect(getApplyAttachOptionsForGeometryMode('mirror')).toEqual({
      applyGeometry: false,
      useSnapshot: false,
    });
  });

  it('only owner should post-attach fit to drive PTY from container', () => {
    expect(shouldPostOwnerFitAfterAttach('owner')).toBe(true);
    expect(shouldPostOwnerFitAfterAttach('mirror')).toBe(false);
  });
});
