import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GIT_INTEGRATION_ENABLED,
  gitBranchFlagIgnoredNote,
  gitEnabledForActiveProject,
  isGitIntegrationEnabled,
  joinGitCliStderrNotes,
  normalizeGitIntegrationEnabled,
  normalizeGitlessSingleSessionPerFolder,
  stripGitBranchCliFields,
} from './gitIntegration';

describe('gitIntegration', () => {
  it('normalizes missing git integration values to true', () => {
    expect(normalizeGitIntegrationEnabled(undefined)).toBe(true);
    expect(normalizeGitIntegrationEnabled(true)).toBe(true);
    expect(normalizeGitIntegrationEnabled(false)).toBe(false);
  });

  it('normalizes missing gitless single-session values to true', () => {
    expect(normalizeGitlessSingleSessionPerFolder(undefined)).toBe(true);
    expect(normalizeGitlessSingleSessionPerFolder(true)).toBe(true);
    expect(normalizeGitlessSingleSessionPerFolder(false)).toBe(false);
  });

  it('isGitIntegrationEnabled reads project field', () => {
    expect(isGitIntegrationEnabled(null)).toBe(true);
    expect(isGitIntegrationEnabled({})).toBe(true);
    expect(isGitIntegrationEnabled({ gitIntegrationEnabled: false })).toBe(false);
  });

  it('gitEnabledForActiveProject reads config via project dir', async () => {
    const getGitIntegrationEnabledAt = vi.fn(async () => false);
    await expect(
      gitEnabledForActiveProject({
        getProjectDir: () => '/tmp/project',
        getGitIntegrationEnabledAt,
      }),
    ).resolves.toBe(false);
    expect(getGitIntegrationEnabledAt).toHaveBeenCalledWith('/tmp/project');
  });

  it('gitEnabledForActiveProject defaults when no project dir', async () => {
    await expect(
      gitEnabledForActiveProject({
        getProjectDir: () => null,
        getGitIntegrationEnabledAt: vi.fn(),
      }),
    ).resolves.toBe(DEFAULT_GIT_INTEGRATION_ENABLED);
  });

  it('stripGitBranchCliFields removes branch flags when git is off', () => {
    const { value, stderrNotes } = stripGitBranchCliFields(
      {
        title: 'Task',
        sourceBranch: 'feature/x',
        createSourceBranchIfMissing: true,
      },
      false,
    );
    expect(value.title).toBe('Task');
    expect(value.sourceBranch).toBeUndefined();
    expect(value.createSourceBranchIfMissing).toBeUndefined();
    expect(stderrNotes).toEqual([
      gitBranchFlagIgnoredNote('--source-branch'),
      gitBranchFlagIgnoredNote('--create-source-branch-if-missing'),
    ]);
    expect(joinGitCliStderrNotes(stderrNotes)).toContain('git integration is disabled');
  });

  it('stripGitBranchCliFields preserves branch flags when git is on', () => {
    const { value, stderrNotes } = stripGitBranchCliFields(
      { sourceBranch: 'main', createSourceBranchIfMissing: false },
      true,
    );
    expect(value.sourceBranch).toBe('main');
    expect(value.createSourceBranchIfMissing).toBe(false);
    expect(stderrNotes).toEqual([]);
  });
});
