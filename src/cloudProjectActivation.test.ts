import { describe, expect, it } from 'vitest';
import {
  cloudProjectNeedsRepoBinding,
  cloudProjectUsesLegacyFolderPicker,
  hasCloudRepoMachineBinding,
  shellCloudBinding,
} from './cloudProjectActivation';

describe('cloudProjectActivation', () => {
  const shared = [
    { id: 'primary-id', name: 'App', baseBranch: 'main' },
    { id: 'other-id', name: 'Lib', baseBranch: 'develop' },
  ];

  it('detects legacy folder-picker projects', () => {
    expect(cloudProjectUsesLegacyFolderPicker(undefined)).toBe(true);
    expect(cloudProjectUsesLegacyFolderPicker([])).toBe(true);
    expect(cloudProjectUsesLegacyFolderPicker(shared)).toBe(false);
  });

  it('needs repo when shared repos exist but primary is unbound', () => {
    expect(cloudProjectNeedsRepoBinding('p1', shared, null)).toBe(true);
    expect(
      cloudProjectNeedsRepoBinding('p1', shared, {
        lastOpenedAt: 't',
        repoBindings: { 'other-id': { rootPath: '/lib', lastOpenedAt: 't' } },
      }),
    ).toBe(true);
    expect(
      cloudProjectNeedsRepoBinding('p1', shared, {
        lastOpenedAt: 't',
        primaryRepoId: 'primary-id',
        repoBindings: {
          'primary-id': { rootPath: '/app', lastOpenedAt: 't' },
        },
      }),
    ).toBe(false);
  });

  it('does not need repo for zero-repo team projects', () => {
    expect(cloudProjectNeedsRepoBinding('p1', undefined, null)).toBe(false);
  });

  it('shell binding has no machine clone', () => {
    const shell = shellCloudBinding('2026-01-01T00:00:00.000Z');
    expect(hasCloudRepoMachineBinding('p1', shell, shared)).toBe(false);
  });
});
