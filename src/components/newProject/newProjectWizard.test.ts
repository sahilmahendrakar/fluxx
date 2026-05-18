import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeTeamInviteEmails,
  prepareLocalProjectCreateInput,
  projectCreateErrorMessage,
} from '../../projectCreate';
import { deriveStablePrimaryRepoIdForProject } from '../../repoIdentity';
import { stableLocalProjectIdForRoot } from '../../main/projectDirLayout';
import {
  resolvePrimaryRootPath,
  suggestProjectNameFromRepo,
  wizardReposToCreateInput,
} from './newProjectWizard';

describe('suggestProjectNameFromRepo', () => {
  it('uses the repo folder basename', () => {
    expect(suggestProjectNameFromRepo('/Users/dev/payments-api')).toBe('payments-api');
  });
});

describe('resolvePrimaryRootPath', () => {
  it('returns undefined when there are no repos', () => {
    expect(resolvePrimaryRootPath([], undefined)).toBeUndefined();
  });

  it('uses the sole repo when only one is attached', () => {
    const repos = [{ key: 'a', rootPath: '/tmp/a' }];
    expect(resolvePrimaryRootPath(repos, undefined)).toBe('/tmp/a');
  });

  it('prefers the selected primary when multiple repos exist', () => {
    const repos = [
      { key: 'a', rootPath: '/tmp/a' },
      { key: 'b', rootPath: '/tmp/b' },
    ];
    expect(resolvePrimaryRootPath(repos, '/tmp/b')).toBe('/tmp/b');
  });
});

describe('prepareLocalProjectCreateInput', () => {
  it('omits primaryRepoId for zero-repo projects', () => {
    const input = prepareLocalProjectCreateInput({
      name: 'Planning',
      repos: [],
    });
    expect(input).toEqual({
      name: 'Planning',
      repos: [],
      syncMode: 'local-only',
    });
  });

  it('sets primaryRepoId for a single repo', () => {
    const root = path.resolve('/tmp/solo');
    const input = prepareLocalProjectCreateInput({
      name: 'Solo',
      repos: [{ rootPath: root }],
    });
    const projectId = stableLocalProjectIdForRoot(root);
    expect(input.primaryRepoId).toBe(
      deriveStablePrimaryRepoIdForProject({ projectId, rootPath: root }),
    );
    expect(input.syncMode).toBe('local-only');
  });
});

describe('normalizeTeamInviteEmails', () => {
  it('dedupes and lowercases valid emails', () => {
    expect(
      normalizeTeamInviteEmails([' Alice@Co.com ', 'alice@co.com', '']),
    ).toEqual({ ok: true, emails: ['alice@co.com'] });
  });

  it('rejects invalid addresses', () => {
    expect(normalizeTeamInviteEmails(['not-an-email'])).toEqual({
      ok: false,
      error: 'INVITE_INVALID_EMAIL',
    });
  });
});

describe('projectCreateErrorMessage', () => {
  it('maps known error codes', () => {
    expect(projectCreateErrorMessage('AUTH_REQUIRED')).toContain('Sign in');
    expect(projectCreateErrorMessage('DUPLICATE_REPO_PATH')).toContain('already attached');
  });
});

describe('wizardReposToCreateInput', () => {
  it('strips wizard keys', () => {
    expect(
      wizardReposToCreateInput([
        { key: 'k', rootPath: '/tmp/r', name: 'R', baseBranch: 'develop' },
      ]),
    ).toEqual([{ rootPath: '/tmp/r', name: 'R', baseBranch: 'develop' }]);
  });
});
