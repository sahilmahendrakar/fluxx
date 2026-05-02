import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import {
  buildCreateTaskBranchPayload,
  buildTaskSourceBranchPersistPatch,
  classifyGitBranchPresence,
  effectiveTaskSourceBranchShort,
  gitBranchShortNameLooksValid,
  mergeDiscoveryBranchSuggestions,
  normalizeGitBranchShortName,
  planTaskSourceBranchFieldsForCreate,
  resolveCreateSourceBranchIfMissingForStart,
  taskCardShouldShowSourceBranchChip,
  taskSourceBranchPersistIsNoOp,
} from './taskBranches';

describe('normalizeGitBranchShortName', () => {
  it('trims and strips refs/heads', () => {
    expect(normalizeGitBranchShortName('  refs/heads/feature/x  ')).toBe('feature/x');
  });

  it('maps origin/foo to foo', () => {
    expect(normalizeGitBranchShortName('origin/main')).toBe('main');
  });

  it('strips refs/remotes/origin/', () => {
    expect(normalizeGitBranchShortName('refs/remotes/origin/develop')).toBe('develop');
  });
});

describe('classifyGitBranchPresence', () => {
  const locals = ['main', 'dev'];
  const remotes = ['origin/side', 'origin/main'];

  it('classifies both', () => {
    const r = classifyGitBranchPresence('main', locals, remotes);
    expect(r.normalizedShort).toBe('main');
    expect(r.presence).toBe('both');
  });

  it('classifies local-only', () => {
    const r = classifyGitBranchPresence('dev', locals, remotes);
    expect(r.presence).toBe('local');
  });

  it('classifies remote-only', () => {
    const r = classifyGitBranchPresence('side', locals, remotes);
    expect(r.presence).toBe('remote');
  });

  it('classifies missing', () => {
    const r = classifyGitBranchPresence('new-branch', locals, remotes);
    expect(r.presence).toBe('missing');
  });

  it('normalizes origin/ prefix in the request', () => {
    const r = classifyGitBranchPresence('origin/main', [], ['main']);
    expect(r.normalizedShort).toBe('main');
    expect(r.presence).toBe('remote');
  });
});

describe('effectiveTaskSourceBranchShort', () => {
  it('falls back to project default when task omits sourceBranch', () => {
    const task = {} as Pick<Task, 'sourceBranch'>;
    expect(effectiveTaskSourceBranchShort(task, 'main')).toBe('main');
  });

  it('uses task.sourceBranch when set', () => {
    expect(
      effectiveTaskSourceBranchShort({ sourceBranch: 'origin/foo' } as Task, 'main'),
    ).toBe('foo');
  });
});

describe('resolveCreateSourceBranchIfMissingForStart', () => {
  it('returns false when branch exists', () => {
    expect(
      resolveCreateSourceBranchIfMissingForStart({ createSourceBranchIfMissing: true }, 'both'),
    ).toBe(false);
  });

  it('returns false when missing but flag is false', () => {
    expect(
      resolveCreateSourceBranchIfMissingForStart(
        { createSourceBranchIfMissing: false },
        'missing',
      ),
    ).toBe(false);
  });

  it('returns true when missing and flag true', () => {
    expect(
      resolveCreateSourceBranchIfMissingForStart(
        { createSourceBranchIfMissing: true },
        'missing',
      ),
    ).toBe(true);
  });

  it('defaults true when missing and flag omitted', () => {
    expect(resolveCreateSourceBranchIfMissingForStart({} as Task, 'missing')).toBe(true);
  });
});

describe('planTaskSourceBranchFieldsForCreate', () => {
  const disc = {
    defaultBranchShort: 'main',
    localBranches: ['main'],
    remoteBranches: ['origin/release'],
  };

  it('defaults source to project default and create false when branch exists', () => {
    const p = planTaskSourceBranchFieldsForCreate(disc, {});
    expect(p.sourceBranch).toBe('main');
    expect(p.createSourceBranchIfMissing).toBe(false);
  });

  it('sets create true for new branch name by default', () => {
    const p = planTaskSourceBranchFieldsForCreate(disc, { sourceBranch: 'feature-xyz' });
    expect(p.sourceBranch).toBe('feature-xyz');
    expect(p.createSourceBranchIfMissing).toBe(true);
  });

  it('honors explicit create false for missing branch', () => {
    const p = planTaskSourceBranchFieldsForCreate(disc, {
      sourceBranch: 'feature-xyz',
      createSourceBranchIfMissing: false,
    });
    expect(p.createSourceBranchIfMissing).toBe(false);
  });
});

describe('gitBranchShortNameLooksValid', () => {
  it('accepts typical feature branch names', () => {
    expect(gitBranchShortNameLooksValid('feature/foo-bar')).toBe(true);
    expect(gitBranchShortNameLooksValid('main')).toBe(true);
  });

  it('rejects empty and whitespace-only', () => {
    expect(gitBranchShortNameLooksValid('')).toBe(false);
    expect(gitBranchShortNameLooksValid('   ')).toBe(false);
  });

  it('rejects spaces and other forbidden characters', () => {
    expect(gitBranchShortNameLooksValid('bad name')).toBe(false);
    expect(gitBranchShortNameLooksValid('a..b')).toBe(false);
    expect(gitBranchShortNameLooksValid('.hidden')).toBe(false);
    expect(gitBranchShortNameLooksValid('x.lock')).toBe(false);
  });
});

describe('taskCardShouldShowSourceBranchChip', () => {
  it('hides chip for legacy default (no sourceBranch)', () => {
    expect(taskCardShouldShowSourceBranchChip({}, 'main')).toBe(false);
  });

  it('shows chip when create is pending', () => {
    expect(
      taskCardShouldShowSourceBranchChip(
        { sourceBranch: 'x', createSourceBranchIfMissing: true } as Task,
        'main',
      ),
    ).toBe(true);
  });

  it('shows chip when source differs from default', () => {
    expect(
      taskCardShouldShowSourceBranchChip({ sourceBranch: 'develop' } as Task, 'main'),
    ).toBe(true);
  });

  it('hides chip when source matches default', () => {
    expect(taskCardShouldShowSourceBranchChip({ sourceBranch: 'main' } as Task, 'main')).toBe(
      false,
    );
  });
});

describe('mergeDiscoveryBranchSuggestions', () => {
  it('dedupes and includes default', () => {
    const s = mergeDiscoveryBranchSuggestions({
      defaultBranchShort: 'main',
      localBranches: ['main', 'dev'],
      remoteBranches: ['origin/main', 'origin/dev'],
    });
    expect(s).toContain('main');
    expect(s).toContain('dev');
    expect(s.filter((x) => x === 'main').length).toBe(1);
  });
});

describe('buildCreateTaskBranchPayload', () => {
  const disc = {
    defaultBranchShort: 'main',
    localBranches: ['main'],
    remoteBranches: [] as string[],
  };

  it('returns undefined when discovery is missing and input is blank', () => {
    expect(buildCreateTaskBranchPayload('  ', null)).toBeUndefined();
  });

  it('forwards raw name only when discovery is null', () => {
    expect(buildCreateTaskBranchPayload('  feature-x  ', null)).toEqual({
      sourceBranch: 'feature-x',
    });
  });

  it('plans default when input blank and discovery present', () => {
    expect(buildCreateTaskBranchPayload('', disc)).toEqual({
      sourceBranch: 'main',
      createSourceBranchIfMissing: false,
    });
  });

  it('plans new branch when name is missing from clone', () => {
    expect(buildCreateTaskBranchPayload('flux/new-line', disc)).toEqual({
      sourceBranch: 'flux/new-line',
      createSourceBranchIfMissing: true,
    });
  });
});

describe('buildTaskSourceBranchPersistPatch', () => {
  const disc = {
    defaultBranchShort: 'main',
    localBranches: ['main'],
    remoteBranches: [] as string[],
  };

  it('clears stored fields when targeting default existing branch', () => {
    expect(
      buildTaskSourceBranchPersistPatch(
        { sourceBranch: 'main', createSourceBranchIfMissing: false },
        disc,
      ),
    ).toEqual({ sourceBranch: '', createSourceBranchIfMissing: false });
  });

  it('keeps explicit branch when not default', () => {
    expect(
      buildTaskSourceBranchPersistPatch(
        { sourceBranch: 'develop', createSourceBranchIfMissing: false },
        disc,
      ),
    ).toEqual({ sourceBranch: 'develop', createSourceBranchIfMissing: false });
  });

  it('does not clear when default name is still pending creation', () => {
    expect(
      buildTaskSourceBranchPersistPatch(
        { sourceBranch: 'main', createSourceBranchIfMissing: true },
        disc,
      ),
    ).toEqual({ sourceBranch: 'main', createSourceBranchIfMissing: true });
  });
});

describe('taskSourceBranchPersistIsNoOp', () => {
  const disc = {
    defaultBranchShort: 'main',
    localBranches: ['main'],
    remoteBranches: [] as string[],
  };

  it('is no-op for legacy task when planned is default', () => {
    expect(
      taskSourceBranchPersistIsNoOp(
        {} as Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing'>,
        { sourceBranch: 'main', createSourceBranchIfMissing: false },
        disc,
      ),
    ).toBe(true);
  });

  it('is not no-op when clearing redundant explicit default', () => {
    expect(
      taskSourceBranchPersistIsNoOp(
        { sourceBranch: 'main' } as Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing'>,
        { sourceBranch: 'main', createSourceBranchIfMissing: false },
        disc,
      ),
    ).toBe(false);
  });

  it('is no-op when stored feature matches planned', () => {
    expect(
      taskSourceBranchPersistIsNoOp(
        { sourceBranch: 'develop', createSourceBranchIfMissing: false } as Pick<
          Task,
          'sourceBranch' | 'createSourceBranchIfMissing'
        >,
        { sourceBranch: 'develop', createSourceBranchIfMissing: false },
        disc,
      ),
    ).toBe(true);
  });
});
