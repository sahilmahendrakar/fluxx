import { describe, expect, it } from 'vitest';
import { parseFirestoreRepos } from './cloudFirestoreRepoParse';

describe('parseFirestoreRepos', () => {
  it('returns undefined for missing or empty arrays', () => {
    expect(parseFirestoreRepos(undefined)).toBeUndefined();
    expect(parseFirestoreRepos([])).toBeUndefined();
    expect(parseFirestoreRepos('nope')).toBeUndefined();
  });

  it('parses valid rows and optional remoteUrl', () => {
    expect(
      parseFirestoreRepos([
        { id: 'r1', name: 'App', baseBranch: 'main', remoteUrl: ' https://github.com/o/r ' },
        { id: 'r2', name: 'Lib', baseBranch: 'develop' },
      ]),
    ).toEqual([
      { id: 'r1', name: 'App', baseBranch: 'main', remoteUrl: 'https://github.com/o/r' },
      { id: 'r2', name: 'Lib', baseBranch: 'develop' },
    ]);
  });

  it('skips invalid entries and trims repo ids', () => {
    expect(
      parseFirestoreRepos([
        { id: '  ok  ', name: 'X', baseBranch: 'main' },
        { id: '', name: 'Bad', baseBranch: 'main' },
        { name: 'No id', baseBranch: 'main' },
        null,
      ]),
    ).toEqual([{ id: 'ok', name: 'X', baseBranch: 'main' }]);
  });
});
