import { describe, expect, it } from 'vitest';
import type { CloudSharedRepo, RepoConfig } from '../types';
import {
  DUPLICATE_CLOUD_PATH_MESSAGE,
  DUPLICATE_GITHUB_REPO_MESSAGE,
  DUPLICATE_LOCAL_PATH_MESSAGE,
  buildCloudSharedRepoForGithubAttach,
  findDuplicateCloudRepoByPath,
  findDuplicateCloudSharedRepoByGithubSlug,
  findDuplicateLocalRepoByGithubSlug,
  findDuplicateLocalRepoByPath,
  githubFieldsFromAttachMetadata,
  githubRemoteUrlForAttach,
  parseGithubNameWithOwner,
  validateGithubRepoAttachForCloud,
  validateGithubRepoAttachForLocal,
} from './githubRepoAttach';

describe('parseGithubNameWithOwner', () => {
  it('parses owner/repo slugs', () => {
    expect(parseGithubNameWithOwner('Acme/My-Repo')).toEqual({
      owner: 'acme',
      repo: 'my-repo',
    });
  });

  it('rejects invalid slugs', () => {
    expect(parseGithubNameWithOwner('no-slash')).toBeNull();
    expect(parseGithubNameWithOwner('/bad')).toBeNull();
  });
});

describe('githubRemoteUrlForAttach', () => {
  it('prefers explicit url', () => {
    expect(
      githubRemoteUrlForAttach({
        nameWithOwner: 'acme/r',
        url: 'git@github.com:acme/r.git',
      }),
    ).toBe('git@github.com:acme/r.git');
  });

  it('builds https url from slug', () => {
    expect(githubRemoteUrlForAttach({ nameWithOwner: 'acme/r' })).toBe(
      'https://github.com/acme/r.git',
    );
  });
});

describe('duplicate detection', () => {
  const repos: RepoConfig[] = [
    {
      id: 'r1',
      rootPath: '/w/a',
      baseBranch: 'main',
      githubOwner: 'acme',
      githubName: 'alpha',
    },
  ];

  it('finds duplicate local path', () => {
    expect(findDuplicateLocalRepoByPath(repos, '/w/a')).toEqual(repos[0]);
    expect(findDuplicateLocalRepoByPath(repos, '/w/b')).toBeUndefined();
  });

  it('finds duplicate local github slug', () => {
    expect(
      findDuplicateLocalRepoByGithubSlug(repos, { owner: 'acme', repo: 'alpha' }),
    ).toEqual(repos[0]);
    expect(
      findDuplicateLocalRepoByGithubSlug(repos, { owner: 'acme', repo: 'beta' }),
    ).toBeUndefined();
  });

  it('finds duplicate cloud path in bindings', () => {
    expect(
      findDuplicateCloudRepoByPath({
        rootPath: '/w/a',
        repoMachineBindings: {
          r1: { rootPath: '/w/a', lastOpenedAt: 't' },
        },
      }),
    ).toBe(true);
  });

  it('finds duplicate cloud github via remoteUrl', () => {
    const shared: CloudSharedRepo[] = [
      {
        id: 'r1',
        name: 'Alpha',
        baseBranch: 'main',
        remoteUrl: 'https://github.com/acme/alpha.git',
      },
    ];
    expect(
      findDuplicateCloudSharedRepoByGithubSlug(shared, { owner: 'acme', repo: 'alpha' }),
    ).toEqual(shared[0]);
  });
});

describe('validateGithubRepoAttachForLocal', () => {
  it('rejects duplicate path and github repo', () => {
    const repos: RepoConfig[] = [
      { id: 'r1', rootPath: '/w/a', baseBranch: 'main', githubOwner: 'o', githubName: 'r' },
    ];
    expect(
      validateGithubRepoAttachForLocal({
        repos,
        input: { rootPath: '/w/a', github: { nameWithOwner: 'o/r' } },
      }),
    ).toEqual({ ok: false, message: DUPLICATE_LOCAL_PATH_MESSAGE });
    expect(
      validateGithubRepoAttachForLocal({
        repos,
        input: { rootPath: '/w/b', github: { nameWithOwner: 'o/r' } },
      }),
    ).toEqual({ ok: false, message: DUPLICATE_GITHUB_REPO_MESSAGE });
  });

  it('allows new attach', () => {
    expect(
      validateGithubRepoAttachForLocal({
        repos: [],
        input: { rootPath: '/w/new', github: { nameWithOwner: 'acme/new' } },
      }),
    ).toEqual({ ok: true });
  });
});

describe('buildCloudSharedRepoForGithubAttach', () => {
  it('sets github fields and remoteUrl', () => {
    const repo = buildCloudSharedRepoForGithubAttach({
      projectId: 'p1',
      rootPath: '/w/clone',
      sharedRepos: [],
      github: { nameWithOwner: 'acme/widget', url: 'https://github.com/acme/widget.git' },
    });
    expect(repo).toMatchObject({
      name: 'widget',
      baseBranch: 'main',
      githubOwner: 'acme',
      githubName: 'widget',
      remoteUrl: 'https://github.com/acme/widget.git',
    });
    expect(repo?.id).toBeTruthy();
  });
});

describe('validateGithubRepoAttachForCloud', () => {
  it('rejects duplicate cloud path', () => {
    const result = validateGithubRepoAttachForCloud({
      projectId: 'p1',
      sharedRepos: [],
      repoMachineBindings: {
        r0: { rootPath: '/w/x', lastOpenedAt: 't' },
      },
      input: { rootPath: '/w/x', github: { nameWithOwner: 'o/n' } },
    });
    expect(result).toEqual({ ok: false, message: DUPLICATE_CLOUD_PATH_MESSAGE });
  });

  it('returns shared repo row when valid', () => {
    const result = validateGithubRepoAttachForCloud({
      projectId: 'p1',
      sharedRepos: [],
      repoMachineBindings: {},
      input: {
        rootPath: '/w/new',
        github: { nameWithOwner: 'acme/new', defaultBranch: 'develop' },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sharedRepo.baseBranch).toBe('develop');
      expect(githubFieldsFromAttachMetadata({ nameWithOwner: 'acme/new' })).toMatchObject({
        githubOwner: 'acme',
        githubName: 'new',
      });
    }
  });
});

describe('first-repo primary behavior (local)', () => {
  it('empty repos list passes validation for first attach', () => {
    expect(
      validateGithubRepoAttachForLocal({
        repos: [],
        input: { rootPath: '/first', github: { nameWithOwner: 'o/first' } },
      }).ok,
    ).toBe(true);
  });
});
