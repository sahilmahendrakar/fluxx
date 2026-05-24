import { describe, expect, it } from 'vitest';
import {
  getRemoteRepoBinding,
  parseRemoteRepoBinding,
  parseRemoteRepoBindingsByDevice,
} from './remoteRepoBindings';

describe('remoteRepoBindings parse', () => {
  it('parses a binding record', () => {
    expect(
      parseRemoteRepoBinding({
        remotePath: '/home/user/proj',
        boundAt: '2026-05-24T00:00:00.000Z',
        lastValidatedAt: '2026-05-24T01:00:00.000Z',
      }),
    ).toEqual({
      remotePath: '/home/user/proj',
      boundAt: '2026-05-24T00:00:00.000Z',
      lastValidatedAt: '2026-05-24T01:00:00.000Z',
    });
  });

  it('parses nested device map', () => {
    const map = parseRemoteRepoBindingsByDevice({
      dev1: {
        repoA: { remotePath: '/x', boundAt: 't' },
      },
    });
    expect(map?.dev1?.repoA?.remotePath).toBe('/x');
  });

  it('getRemoteRepoBinding reads nested entry', () => {
    const map = parseRemoteRepoBindingsByDevice({
      ssh: { r1: { remotePath: '/bound', boundAt: 't' } },
    });
    expect(getRemoteRepoBinding(map, 'ssh', 'r1')?.remotePath).toBe('/bound');
  });
});
