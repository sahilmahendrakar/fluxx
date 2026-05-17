import { describe, expect, it } from 'vitest';
import { activeProjectKeysEqual } from './activeProjectKey';

describe('activeProjectKeysEqual', () => {
  it('returns true for matching local keys', () => {
    expect(
      activeProjectKeysEqual(
        { kind: 'local', id: 'abc' },
        { kind: 'local', id: 'abc' },
      ),
    ).toBe(true);
  });

  it('returns false when kind differs', () => {
    expect(
      activeProjectKeysEqual(
        { kind: 'local', id: 'abc' },
        { kind: 'cloud', id: 'abc' },
      ),
    ).toBe(false);
  });

  it('returns false when either is null', () => {
    expect(activeProjectKeysEqual(null, { kind: 'local', id: 'x' })).toBe(false);
  });
});
