import { describe, expect, it } from 'vitest';
import {
  boardFilterPickerLabelMatches,
  filterByBoardFilterPickerQuery,
} from './boardFilterOptionSearch';

describe('boardFilterPickerLabelMatches', () => {
  it('treats empty query as matching', () => {
    expect(boardFilterPickerLabelMatches('', 'Anything')).toBe(true);
    expect(boardFilterPickerLabelMatches('   ', 'Anything')).toBe(true);
  });

  it('matches case-insensitive substring', () => {
    expect(boardFilterPickerLabelMatches('foo', 'FooBar')).toBe(true);
    expect(boardFilterPickerLabelMatches('BAR', 'FooBar')).toBe(true);
  });

  it('does not match when substring absent', () => {
    expect(boardFilterPickerLabelMatches('xyz', 'FooBar')).toBe(false);
  });
});

describe('filterByBoardFilterPickerQuery', () => {
  it('returns a copy of all items when query is empty', () => {
    const items = [{ id: 1 }, { id: 2 }];
    const out = filterByBoardFilterPickerQuery('', items, (i) => String(i.id));
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });

  it('filters by getLabel', () => {
    const items = [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
    ];
    expect(filterByBoardFilterPickerQuery('lic', items, (i) => i.name)).toEqual([
      { id: 'a', name: 'Alice' },
    ]);
  });
});
