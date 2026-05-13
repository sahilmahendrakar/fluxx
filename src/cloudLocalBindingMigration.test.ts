import { describe, expect, it } from 'vitest';
import type { CloudProjectLocalBinding } from './types';
import {
  migrateLegacyCloudBinding,
  parseRepoBindingsRecord,
  primaryMachineBinding,
  primaryRootPathFromCloudBinding,
  stripLegacyRootPathForPersistence,
} from './cloudLocalBindingMigration';
import { hydrateCloudProject, resolveCloudPrimaryRepoId } from './cloudBindingPrefs';
import { deriveStablePrimaryRepoIdForProject } from './repoIdentity';

describe('cloudLocalBindingMigration', () => {
  const projectId = 'cloud-proj-abc';

  it('migrates legacy rootPath into repoBindings under a deterministic primary id', () => {
    const legacy: CloudProjectLocalBinding = {
      rootPath: '/Users/me/my-repo',
      lastOpenedAt: '2024-06-01T12:00:00.000Z',
      planningAgent: 'cursor',
      autoStartSessionOnInProgress: true,
    };
    const migrated = migrateLegacyCloudBinding(projectId, legacy);
    const expectedId = deriveStablePrimaryRepoIdForProject({
      projectId,
      rootPath: '/Users/me/my-repo',
    });
    expect(migrated.primaryRepoId).toBe(expectedId);
    expect(migrated.repoBindings?.[expectedId]).toEqual({
      rootPath: '/Users/me/my-repo',
      lastOpenedAt: '2024-06-01T12:00:00.000Z',
    });
    expect(migrated.planningAgent).toBe('cursor');
    expect(migrated.autoStartSessionOnInProgress).toBe(true);
  });

  it('parses new-shape repoBindings records', () => {
    const raw = {
      aa: { rootPath: '/a', lastOpenedAt: 't1' },
      bb: { rootPath: '/b', lastOpenedAt: 't2', extra: true },
    };
    const parsed = parseRepoBindingsRecord(raw);
    expect(parsed).toEqual({
      aa: { rootPath: '/a', lastOpenedAt: 't1' },
      bb: { rootPath: '/b', lastOpenedAt: 't2' },
    });
  });

  it('strips legacy rootPath once repoBindings are present', () => {
    const id = deriveStablePrimaryRepoIdForProject({
      projectId,
      rootPath: '/tmp/r',
    });
    const binding: CloudProjectLocalBinding = {
      rootPath: '/tmp/r',
      lastOpenedAt: 't0',
      repoBindings: { [id]: { rootPath: '/tmp/r', lastOpenedAt: 't0' } },
      primaryRepoId: id,
    };
    const stripped = stripLegacyRootPathForPersistence(binding);
    expect(stripped.rootPath).toBeUndefined();
    expect(stripped.repoBindings?.[id]?.rootPath).toBe('/tmp/r');
  });

  it('primaryMachineBinding resolves the bound clone for legacy and migrated shapes', () => {
    const legacy: CloudProjectLocalBinding = {
      rootPath: '/legacy/path',
      lastOpenedAt: 't',
    };
    expect(primaryMachineBinding(projectId, legacy)?.rootPath).toBe('/legacy/path');

    const migrated = migrateLegacyCloudBinding(projectId, legacy);
    expect(primaryMachineBinding(projectId, migrated)?.rootPath).toBe('/legacy/path');
  });

  it('primaryRootPathFromCloudBinding prefers Firestore repo order when multiple bindings exist', () => {
    const r1 = {
      id: 'repo-one',
      name: 'One',
      baseBranch: 'main',
    };
    const r2 = {
      id: 'repo-two',
      name: 'Two',
      baseBranch: 'develop',
    };
    const binding: CloudProjectLocalBinding = {
      lastOpenedAt: 't',
      primaryRepoId: 'repo-two',
      repoBindings: {
        'repo-one': { rootPath: '/first', lastOpenedAt: 't' },
        'repo-two': { rootPath: '/second', lastOpenedAt: 't' },
      },
    };
    expect(primaryRootPathFromCloudBinding(projectId, binding, [r1, r2])).toBe('/second');
  });

  it('hydrateCloudProject exposes sharedRepos and per-repo machine bindings', () => {
    const summary = {
      id: projectId,
      name: 'Team',
      ownerId: 'o',
      memberIds: ['o'],
      createdAt: 'c',
      repos: [
        {
          id: 'r-main',
          name: 'Main',
          baseBranch: 'main',
          remoteUrl: 'https://example.com/a.git',
        },
        {
          id: 'r-lib',
          name: 'Lib',
          baseBranch: 'main',
        },
      ],
    };
    const binding: CloudProjectLocalBinding = {
      lastOpenedAt: 't',
      primaryRepoId: 'r-main',
      repoBindings: {
        'r-main': { rootPath: '/w/main', lastOpenedAt: 't' },
      },
    };
    const hydrated = hydrateCloudProject(summary, binding);
    expect(hydrated.rootPath).toBe('/w/main');
    expect(hydrated.sharedRepos).toEqual(summary.repos);
    expect(hydrated.repoMachineBindings['r-main']?.rootPath).toBe('/w/main');
    expect(hydrated.repoMachineBindings['r-lib']).toBeUndefined();
  });

  it('resolveCloudPrimaryRepoId matches the shared repo bound at project.rootPath', () => {
    const summary = {
      id: projectId,
      name: 'Team',
      ownerId: 'o',
      memberIds: ['o'],
      createdAt: 'c',
      repos: [
        { id: 'r-a', name: 'A', baseBranch: 'main' },
        { id: 'r-b', name: 'B', baseBranch: 'develop' },
      ],
    };
    const binding: CloudProjectLocalBinding = {
      lastOpenedAt: 't',
      primaryRepoId: 'r-b',
      repoBindings: {
        'r-a': { rootPath: '/clone/a', lastOpenedAt: 't' },
        'r-b': { rootPath: '/clone/b', lastOpenedAt: 't' },
      },
    };
    const hydrated = hydrateCloudProject(summary, binding);
    expect(hydrated.rootPath).toBe('/clone/b');
    expect(resolveCloudPrimaryRepoId(hydrated)).toBe('r-b');
  });
});
