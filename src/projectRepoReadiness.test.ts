import { describe, expect, it } from 'vitest';
import {
  projectRepoActionsBlocked,
  resolveProjectRepoReadiness,
} from './projectRepoReadiness';
import type { RepoConfig } from './types';

const localRepo: RepoConfig = {
  id: 'repo-a',
  name: 'App',
  rootPath: '/tmp/app',
  baseBranch: 'main',
};

describe('resolveProjectRepoReadiness', () => {
  it('reports no_repos for local projects with zero configured repos', () => {
    const r = resolveProjectRepoReadiness({
      projectKind: 'local',
      configuredRepos: [],
      sharedRepos: [],
    });
    expect(r.kind).toBe('no_repos');
    expect(projectRepoActionsBlocked(r)).toBe(true);
    expect(r.message).toContain('No repositories');
  });

  it('reports no_repos for cloud projects without shared or configured repos', () => {
    const r = resolveProjectRepoReadiness({
      projectKind: 'cloud',
      configuredRepos: [],
      sharedRepos: [],
    });
    expect(r.kind).toBe('no_repos');
    expect(r.message).toContain('shared repositories');
  });

  it('reports unbound when the primary shared repo lacks a machine binding', () => {
    const r = resolveProjectRepoReadiness({
      projectKind: 'cloud',
      configuredRepos: [],
      sharedRepos: [{ id: 'primary-id', name: 'App', baseBranch: 'main' }],
      cloudNeedsPrimaryBinding: true,
    });
    expect(r.kind).toBe('unbound');
    expect(r.unboundRepoLabels).toEqual(['App']);
  });

  it('reports unbound for multi-repo cloud when overview shows missing bindings', () => {
    const r = resolveProjectRepoReadiness({
      projectKind: 'cloud',
      configuredRepos: [],
      sharedRepos: [
        { id: 'a', name: 'App', baseBranch: 'main' },
        { id: 'b', name: 'Lib', baseBranch: 'main' },
      ],
      cloudBindingOverview: {
        a: { kind: 'bound', rootPath: '/app', pathStatus: 'valid' },
        b: { kind: 'missing_binding' },
      },
    });
    expect(r.kind).toBe('unbound');
    expect(r.unboundRepoLabels).toEqual(['Lib']);
  });

  it('reports invalid_path when a bound repo path is missing on disk', () => {
    const r = resolveProjectRepoReadiness({
      projectKind: 'local',
      configuredRepos: [localRepo],
      sharedRepos: [],
      repoPathById: { 'repo-a': 'missing' },
    });
    expect(r.kind).toBe('invalid_path');
    expect(r.invalidPathIssues?.[0]?.pathStatus).toBe('missing');
  });

  it('returns ready for a healthy local single-repo project', () => {
    const r = resolveProjectRepoReadiness({
      projectKind: 'local',
      configuredRepos: [localRepo],
      sharedRepos: [],
      repoPathById: { 'repo-a': 'valid' },
    });
    expect(r.kind).toBe('ready');
    expect(projectRepoActionsBlocked(r)).toBe(false);
  });
});
