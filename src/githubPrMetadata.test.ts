import { describe, expect, it } from 'vitest';
import {
  parseGithubPrField,
  parseGhPrViewJsonStdout,
  parseGhPrViewRecord,
} from './githubPrMetadata';
import { isGithubHostingRemote } from './main/githubTaskPr';

describe('parseGithubPrField', () => {
  it('returns undefined for non-objects', () => {
    expect(parseGithubPrField(null)).toBeUndefined();
    expect(parseGithubPrField('x')).toBeUndefined();
    expect(parseGithubPrField([])).toBeUndefined();
  });

  it('requires a non-empty url string', () => {
    expect(parseGithubPrField({})).toBeUndefined();
    expect(parseGithubPrField({ url: '' })).toBeUndefined();
    expect(parseGithubPrField({ url: '   ' })).toBeUndefined();
  });

  it('normalises gh state spellings', () => {
    expect(
      parseGithubPrField({
        url: 'https://github.com/o/r/pull/1',
        state: 'MERGED',
        number: 1,
      }),
    ).toEqual({
      url: 'https://github.com/o/r/pull/1',
      state: 'merged',
      number: 1,
    });
  });

  it('drops invalid state strings', () => {
    const r = parseGithubPrField({
      url: 'https://github.com/o/r/pull/1',
      state: 'nope',
    });
    expect(r?.url).toBe('https://github.com/o/r/pull/1');
    expect(r?.state).toBeUndefined();
  });
});

describe('parseGhPrViewRecord / parseGhPrViewJsonStdout', () => {
  it('maps gh JSON field names to TaskGithubPr', () => {
    const row = parseGhPrViewRecord({
      url: 'https://github.com/o/r/pull/2',
      number: 2,
      state: 'OPEN',
      headRefName: 'flux/task-abc',
      baseRefName: 'main',
      mergedAt: '',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    });
    expect(row).toEqual({
      url: 'https://github.com/o/r/pull/2',
      number: 2,
      state: 'open',
      headBranch: 'flux/task-abc',
      baseBranch: 'main',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    });
  });

  it('parses a wrapped JSON array (gh sometimes returns one-element arrays)', () => {
    const json = JSON.stringify([
      {
        url: 'https://github.com/o/r/pull/3',
        number: 3,
        state: 'CLOSED',
      },
    ]);
    expect(parseGhPrViewJsonStdout(json)).toEqual({
      url: 'https://github.com/o/r/pull/3',
      number: 3,
      state: 'closed',
    });
  });

  it('parses a single JSON object', () => {
    const json = JSON.stringify({
      url: 'https://github.com/o/r/pull/4',
      state: 'MERGED',
      mergedAt: '2024-03-01T12:00:00Z',
    });
    expect(parseGhPrViewJsonStdout(json)).toEqual({
      url: 'https://github.com/o/r/pull/4',
      state: 'merged',
      mergedAt: '2024-03-01T12:00:00Z',
    });
  });

  it('returns null for invalid JSON', () => {
    expect(parseGhPrViewJsonStdout('not json')).toBeNull();
    expect(parseGhPrViewJsonStdout('[]')).toBeNull();
  });
});

describe('isGithubHostingRemote', () => {
  it('accepts common GitHub remote forms', () => {
    expect(isGithubHostingRemote('https://github.com/o/r.git')).toBe(true);
    expect(isGithubHostingRemote('http://github.com/o/r.git')).toBe(true);
    expect(isGithubHostingRemote('git@github.com:o/r.git')).toBe(true);
    expect(isGithubHostingRemote('ssh://git@github.com/o/r.git')).toBe(true);
  });

  it('rejects non-GitHub hosts', () => {
    expect(isGithubHostingRemote('https://gitlab.com/o/r.git')).toBe(false);
    expect(isGithubHostingRemote('git@gitlab.com:o/r.git')).toBe(false);
  });
});
