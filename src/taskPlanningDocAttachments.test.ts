import { describe, expect, it } from 'vitest';
import {
  compactPlanningDocPathLabel,
  normalizeAttachedPlanningDocPaths,
} from './taskPlanningDocAttachments';

describe('normalizeAttachedPlanningDocPaths', () => {
  it('returns empty for non-arrays', () => {
    expect(normalizeAttachedPlanningDocPaths(undefined)).toEqual([]);
    expect(normalizeAttachedPlanningDocPaths(null)).toEqual([]);
    expect(normalizeAttachedPlanningDocPaths({})).toEqual([]);
  });

  it('keeps only valid .md repo-relative paths', () => {
    expect(
      normalizeAttachedPlanningDocPaths([
        'notes/good.md',
        '../evil.md',
        'bad.txt',
        '  other/ok.md  ',
      ]),
    ).toEqual(['notes/good.md', 'other/ok.md']);
  });

  it('dedupes preserving first spelling', () => {
    expect(
      normalizeAttachedPlanningDocPaths(['a/x.md', 'a/x.md', 'b/y.md']),
    ).toEqual(['a/x.md', 'b/y.md']);
  });
});

describe('compactPlanningDocPathLabel', () => {
  it('returns the full path when short', () => {
    expect(compactPlanningDocPathLabel('short.md')).toBe('short.md');
  });

  it('prefixes with ellipsis when long', () => {
    expect(compactPlanningDocPathLabel('planning/very/long/nested/document-name-here.md')).toMatch(
      /^…\/document-name-here\.md$/,
    );
  });
});
