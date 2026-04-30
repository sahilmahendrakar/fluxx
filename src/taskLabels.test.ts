import { describe, expect, it } from 'vitest';
import { normalizeTaskLabels, projectLabelCatalog } from './taskLabels';

describe('normalizeTaskLabels', () => {
  it('returns empty for nullish or empty input', () => {
    expect(normalizeTaskLabels(undefined)).toEqual([]);
    expect(normalizeTaskLabels(null)).toEqual([]);
    expect(normalizeTaskLabels([])).toEqual([]);
  });

  it('trims and drops empty strings', () => {
    expect(normalizeTaskLabels(['  a  ', ''])).toEqual(['a']);
    expect(normalizeTaskLabels(['\t', 'b'])).toEqual(['b']);
  });

  it('deduplicates case-insensitively keeping first spelling', () => {
    expect(normalizeTaskLabels(['Feature', 'feature', 'FEATURE'])).toEqual(['Feature']);
    expect(normalizeTaskLabels(['x', 'Y', 'x'])).toEqual(['x', 'Y']);
  });

  it('preserves order of first unique labels', () => {
    expect(normalizeTaskLabels(['b', 'a', 'A'])).toEqual(['b', 'a']);
  });
});

describe('projectLabelCatalog', () => {
  it('collects unique labels and sorts case-insensitively', () => {
    expect(
      projectLabelCatalog([
        { labels: ['Zebra', 'api'] },
        { labels: ['zebra', 'Auth'] },
        { labels: undefined },
      ]),
    ).toEqual(['api', 'Auth', 'Zebra']);
  });
});
