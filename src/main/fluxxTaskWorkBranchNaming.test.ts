import { describe, expect, it } from 'vitest';
import {
  chooseFluxxTaskWorkBranchName,
  slugifySingleBranchSegment,
  worktreePathSegmentsForFluxxBranch,
} from './fluxxTaskWorkBranchNaming';

describe('slugifySingleBranchSegment', () => {
  it('normalizes diacritics and punctuation', () => {
    expect(slugifySingleBranchSegment('José O`Neil', 40)).toBe('jose-o-neil');
  });

  it('respects max length', () => {
    expect(slugifySingleBranchSegment('abcdefghijklmnop', 5)).toBe('abcde');
  });
});

describe('worktreePathSegmentsForFluxxBranch', () => {
  it('splits on slash', () => {
    expect(worktreePathSegmentsForFluxxBranch('a/b-c')).toEqual(['a', 'b-c']);
  });
});

describe('chooseFluxxTaskWorkBranchName', () => {
  it('builds author/title and bumps on collision', () => {
    const taken = new Set<string>(['jane/feature'.toLowerCase()]);
    const first = chooseFluxxTaskWorkBranchName({
      authorSlug: 'jane',
      taskTitle: 'Feature',
      taskId: 't1',
      takenShortNames: taken,
    });
    expect(first).toBe('jane/feature-2');
  });

  it('falls back to hashed title when collisions exhaust numeric suffixes', () => {
    const taken = new Set<string>();
    for (let n = 1; n <= 99; n++) {
      taken.add(n === 1 ? 'jane/x' : `jane/x-${n}`.toLowerCase());
    }
    const b = chooseFluxxTaskWorkBranchName({
      authorSlug: 'jane',
      taskTitle: 'x',
      taskId: 'tid-9',
      takenShortNames: taken,
    });
    expect(b.startsWith('jane/x-')).toBe(true);
    expect(b).toMatch(/[a-f0-9]{7}$/);
    expect(b.length).toBeLessThanOrEqual(200);
  });
});
