import { describe, expect, it } from 'vitest';
import {
  buildGhPrCreateArgs,
  classifyRemotePrBaseReadiness,
  extractPrUrlFromGhOutput,
  mergeTaskPrPersistFields,
  prMetadataRefMismatchWarning,
} from './main/githubTaskPr';

describe('classifyRemotePrBaseReadiness', () => {
  it('prefers remote, then local publish, else missing', () => {
    expect(classifyRemotePrBaseReadiness({ originHasBranch: true, localHasBranch: false })).toBe(
      'remote_ok',
    );
    expect(classifyRemotePrBaseReadiness({ originHasBranch: true, localHasBranch: true })).toBe(
      'remote_ok',
    );
    expect(classifyRemotePrBaseReadiness({ originHasBranch: false, localHasBranch: true })).toBe(
      'push_local',
    );
    expect(classifyRemotePrBaseReadiness({ originHasBranch: false, localHasBranch: false })).toBe(
      'missing_everywhere',
    );
  });
});

describe('buildGhPrCreateArgs', () => {
  it('passes stable flags supported by gh pr create', () => {
    expect(
      buildGhPrCreateArgs({
        title: 'T',
        body: 'B',
        baseBranch: 'feature/foo',
        headBranch: 'flux/task-abc',
      }),
    ).toEqual([
      'pr',
      'create',
      '--title',
      'T',
      '--body',
      'B',
      '--base',
      'feature/foo',
      '--head',
      'flux/task-abc',
    ]);
  });
});

describe('extractPrUrlFromGhOutput', () => {
  it('extracts the created GitHub PR URL from gh stdout', () => {
    expect(
      extractPrUrlFromGhOutput('Creating pull request for flux/task-abc into main\n\nhttps://github.com/o/r/pull/12\n'),
    ).toBe('https://github.com/o/r/pull/12');
  });

  it('returns null when gh output does not include a GitHub PR URL', () => {
    expect(extractPrUrlFromGhOutput('')).toBeNull();
    expect(extractPrUrlFromGhOutput('https://github.com/o/r/issues/12')).toBeNull();
  });
});

describe('mergeTaskPrPersistFields', () => {
  it('pins head and base from Flux session and task source', () => {
    const merged = mergeTaskPrPersistFields(
      {
        url: 'https://github.com/o/r/pull/1',
        number: 1,
        state: 'open',
        headBranch: 'wrong-head',
        baseBranch: 'wrong-base',
      },
      'flux/task-x',
      'feature/foo',
    );
    expect(merged.headBranch).toBe('flux/task-x');
    expect(merged.baseBranch).toBe('feature/foo');
    expect(merged.url).toContain('/pull/1');
  });
});

describe('prMetadataRefMismatchWarning', () => {
  it('returns undefined when refs align or nothing stored', () => {
    expect(
      prMetadataRefMismatchWarning(undefined, {
        url: 'u',
        headBranch: 'a',
        baseBranch: 'b',
      }),
    ).toBeUndefined();
    expect(
      prMetadataRefMismatchWarning(
        { url: 'u', headBranch: 'h', baseBranch: 'main' },
        { url: 'u', headBranch: 'h', baseBranch: 'main' },
      ),
    ).toBeUndefined();
  });

  it('describes head and base drift from GitHub', () => {
    const w = prMetadataRefMismatchWarning(
      { url: 'u', headBranch: 'flux/task-old', baseBranch: 'main' },
      { url: 'u', headBranch: 'flux/task-new', baseBranch: 'develop' },
    );
    expect(w).toContain('flux/task-new');
    expect(w).toContain('flux/task-old');
    expect(w).toContain('develop');
    expect(w).toContain('main');
  });
});
