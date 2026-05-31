import { describe, expect, it } from 'vitest';
import {
  buildGithubRepoCreatePayload,
  filterGithubRepos,
  githubPrerequisitesUiState,
  githubRepoAddOptionDisabledTitle,
  isGithubRepoAddOptionEnabled,
  joinCloneDestinationPath,
  repoBasenameFromNameWithOwner,
  validateNewGithubRepoForm,
} from './githubRepoOnboardingUi';

describe('Add repo dropdown gating', () => {
  it('enables GitHub when git integration is on', () => {
    expect(isGithubRepoAddOptionEnabled(true)).toBe(true);
    expect(githubRepoAddOptionDisabledTitle(true)).toBeUndefined();
  });

  it('disables GitHub with guidance when git integration is off', () => {
    expect(isGithubRepoAddOptionEnabled(false)).toBe(false);
    expect(githubRepoAddOptionDisabledTitle(false)).toContain('git integration');
  });
});

describe('githubPrerequisitesUiState', () => {
  it('blocks when gh is missing or not authenticated', () => {
    expect(
      githubPrerequisitesUiState({
        installed: false,
        authenticated: false,
      }),
    ).toBe('blocked');
    expect(
      githubPrerequisitesUiState({
        installed: true,
        authenticated: false,
        version: 'gh 2.0.0',
      }),
    ).toBe('blocked');
  });

  it('is ready when installed and authenticated', () => {
    expect(
      githubPrerequisitesUiState({
        installed: true,
        authenticated: true,
        version: 'gh 2.0.0',
      }),
    ).toBe('ready');
  });
});

describe('clone destination helpers', () => {
  it('extracts repo basename from owner/name', () => {
    expect(repoBasenameFromNameWithOwner('acme/payments-api')).toBe('payments-api');
  });

  it('joins parent and repo folder with platform separator', () => {
    expect(joinCloneDestinationPath('/Users/dev', 'payments-api')).toBe('/Users/dev/payments-api');
    expect(joinCloneDestinationPath('C:\\dev\\', 'payments-api')).toBe('C:\\dev\\payments-api');
  });
});

describe('validateNewGithubRepoForm', () => {
  it('defaults to private without extra confirmation', () => {
    expect(
      validateNewGithubRepoForm({
        owner: '',
        name: 'my-repo',
        visibility: 'private',
        description: '',
        confirmNonPrivate: false,
      }),
    ).toBeNull();
  });

  it('requires explicit confirmation for public repos', () => {
    expect(
      validateNewGithubRepoForm({
        owner: '',
        name: 'my-repo',
        visibility: 'public',
        description: '',
        confirmNonPrivate: false,
      }),
    ).toContain('Confirm');
    expect(
      validateNewGithubRepoForm({
        owner: '',
        name: 'my-repo',
        visibility: 'public',
        description: '',
        confirmNonPrivate: true,
      }),
    ).toBeNull();
  });

  it('rejects invalid repo names', () => {
    expect(
      validateNewGithubRepoForm({
        owner: '',
        name: 'bad name',
        visibility: 'private',
        description: '',
        confirmNonPrivate: false,
      }),
    ).toContain('invalid');
  });
});

describe('buildGithubRepoCreatePayload', () => {
  it('includes owner when provided', () => {
    expect(
      buildGithubRepoCreatePayload({
        owner: 'acme',
        name: 'svc',
        visibility: 'private',
        description: '  hello  ',
        confirmNonPrivate: false,
      }),
    ).toEqual({
      name: 'svc',
      owner: 'acme',
      visibility: 'private',
      description: 'hello',
    });
  });
});

describe('filterGithubRepos', () => {
  it('filters by name and description', () => {
    const repos = [
      { nameWithOwner: 'acme/api', description: 'Payments' },
      { nameWithOwner: 'acme/web', description: 'Frontend' },
    ];
    expect(filterGithubRepos(repos, 'payment')).toEqual([repos[0]]);
    expect(filterGithubRepos(repos, 'acme/web')).toEqual([repos[1]]);
  });
});
