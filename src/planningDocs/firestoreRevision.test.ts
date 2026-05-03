import { describe, it, expect } from 'vitest';
import { revisionFromFirestoreUpdatedAt } from './firestoreRevision';

describe('revisionFromFirestoreUpdatedAt', () => {
  it('formats seconds and nanoseconds', () => {
    expect(revisionFromFirestoreUpdatedAt({ seconds: 12, nanoseconds: 34 })).toBe('12_34');
  });

  it('uses toMillis when present', () => {
    expect(revisionFromFirestoreUpdatedAt({ toMillis: () => 999 })).toBe('ms_999');
  });

  it('returns unknown for primitives and unrecognized shapes', () => {
    expect(revisionFromFirestoreUpdatedAt(undefined)).toBe('unknown');
    expect(revisionFromFirestoreUpdatedAt(null)).toBe('unknown');
    expect(revisionFromFirestoreUpdatedAt('ts')).toBe('unknown');
    expect(revisionFromFirestoreUpdatedAt({ seconds: 'bad' as unknown as number })).toBe('unknown');
  });
});
