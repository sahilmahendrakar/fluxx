import { describe, expect, it } from 'vitest';
import {
  buildGhPrCreateArgs,
  classifyRemotePrBaseReadiness,
  extractPrUrlFromGhOutput,
  mergeTaskPrPersistFields,
  prMetadataRefMismatchWarning,
  selectPreferredGithubPrForHead,
  validateGithubPrMatchesTaskRemote,
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
        headBranch: 'fluxx/task-abc',
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
      'fluxx/task-abc',
    ]);
  });
});

describe('extractPrUrlFromGhOutput', () => {
  it('extracts the created GitHub PR URL from gh stdout', () => {
    expect(
      extractPrUrlFromGhOutput('Creating pull request for fluxx/task-abc into main\n\nhttps://github.com/o/r/pull/12\n'),
    ).toBe('https://github.com/o/r/pull/12');
  });

  it('returns null when gh output does not include a GitHub PR URL', () => {
    expect(extractPrUrlFromGhOutput('')).toBeNull();
    expect(extractPrUrlFromGhOutput('https://github.com/o/r/issues/12')).toBeNull();
  });
});

describe('selectPreferredGithubPrForHead', () => {
  it('prefers merged over open for the same head branch', () => {
    const merged = {
      url: 'https://github.com/o/r/pull/2',
      state: 'merged' as const,
      headBranch: 'fluxx/task-a',
      mergedAt: '2024-02-01T00:00:00Z',
      updatedAt: '2024-02-01T00:00:00Z',
    };
    const open = {
      url: 'https://github.com/o/r/pull/1',
      state: 'open' as const,
      headBranch: 'fluxx/task-a',
      updatedAt: '2024-01-15T00:00:00Z',
    };
    expect(selectPreferredGithubPrForHead([open, merged], 'fluxx/task-a')).toEqual(merged);
  });

  it('ignores PRs whose head does not match the task branch', () => {
    const picked = selectPreferredGithubPrForHead(
      [
        {
          url: 'https://github.com/o/r/pull/3',
          state: 'merged' as const,
          headBranch: 'other-branch',
        },
      ],
      'fluxx/task-a',
    );
    expect(picked).toBeNull();
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
      'fluxx/task-x',
      'feature/foo',
    );
    expect(merged.headBranch).toBe('fluxx/task-x');
    expect(merged.baseBranch).toBe('feature/foo');
    expect(merged.url).toContain('/pull/1');
  });
});

describe('validateGithubPrMatchesTaskRemote (multi-repo2 PR isolation)', () => {
  it('returns null when PR URL or origin cannot be parsed as github slugs', () => {
    expect(validateGithubPrMatchesTaskRemote('not-a-url', 'git@github.com:o/r.git')).toBeNull();
    expect(
      validateGithubPrMatchesTaskRemote('https://github.com/o/r/pull/1', 'https://gitlab.com/x/y.git'),
    ).toBeNull();
  });

  it('returns null when PR repo matches origin', () => {
    expect(
      validateGithubPrMatchesTaskRemote(
        'https://github.com/acme/widget/pull/9',
        'git@github.com:acme/widget.git',
      ),
    ).toBeNull();
  });

  it('rejects PR from a different GitHub repo than the task clone origin', () => {
    const err = validateGithubPrMatchesTaskRemote(
      'https://github.com/org/repo-b/pull/3',
      'https://github.com/org/repo-a.git',
    );
    expect(err).toEqual({
      ok: false,
      code: 'PR_REPO_MISMATCH',
      message:
        'This pull request is on GitHub at org/repo-b, but this task\'s clone uses origin org/repo-a.',
    });
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
      { url: 'u', headBranch: 'fluxx/task-old', baseBranch: 'main' },
      { url: 'u', headBranch: 'fluxx/task-new', baseBranch: 'develop' },
    );
    expect(w).toContain('fluxx/task-new');
    expect(w).toContain('fluxx/task-old');
    expect(w).toContain('develop');
    expect(w).toContain('main');
  });
});
