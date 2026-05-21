import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_MARK_DONE_WHEN_PR_MERGED,
  DEFAULT_AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN,
  DEFAULT_AUTO_RESPOND_TO_TRUST_PROMPTS,
  DEFAULT_AUTO_START_SESSION_ON_IN_PROGRESS,
  hydrateCloudProject,
  resolvedPrefsFromBinding,
} from './cloudBindingPrefs';
import { shellCloudBinding } from './cloudProjectActivation';

describe('resolvedPrefsFromBinding', () => {
  it('uses recommended defaults when automation keys are absent', () => {
    const prefs = resolvedPrefsFromBinding({
      lastOpenedAt: 't',
      repoBindings: { r1: { rootPath: '/x', lastOpenedAt: 't' } },
      primaryRepoId: 'r1',
    });
    expect(prefs.autoStartSessionOnInProgress).toBe(DEFAULT_AUTO_START_SESSION_ON_IN_PROGRESS);
    expect(prefs.autoRespondToTrustPrompts).toBe(DEFAULT_AUTO_RESPOND_TO_TRUST_PROMPTS);
    expect(prefs.autoStartWhenUnblocked).toBe(false);
    expect(prefs.autoCleanupWorkspaceWhenDone).toBe(false);
    expect(prefs.autoMarkDoneWhenPrMerged).toBe(DEFAULT_AUTO_MARK_DONE_WHEN_PR_MERGED);
    expect(prefs.autoMoveToReviewWhenPrOpen).toBe(DEFAULT_AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN);
  });

  it('respects explicit false and true on the binding', () => {
    const prefs = resolvedPrefsFromBinding({
      lastOpenedAt: 't',
      repoBindings: { r1: { rootPath: '/x', lastOpenedAt: 't' } },
      primaryRepoId: 'r1',
      autoStartSessionOnInProgress: false,
      autoMarkDoneWhenPrMerged: false,
      autoMoveToReviewWhenPrOpen: true,
    });
    expect(prefs.autoStartSessionOnInProgress).toBe(false);
    expect(prefs.autoMarkDoneWhenPrMerged).toBe(false);
    expect(prefs.autoMoveToReviewWhenPrOpen).toBe(true);
  });

  it('hydrates shell-only cloud projects using the materialization root', () => {
    const summary = {
      id: 'cloud-1',
      name: 'Team',
      ownerId: 'u1',
      memberIds: ['u1'],
      createdAt: 't',
      repos: [{ id: 'r1', name: 'App', baseBranch: 'main' }],
    };
    const project = hydrateCloudProject(summary, shellCloudBinding('t'), {
      materializationRootPath: '/Users/me/.fluxx/projects/cloud-1',
    });
    expect(project.rootPath).toBe('/Users/me/.fluxx/projects/cloud-1');
    expect(project.sharedRepos).toEqual(summary.repos);
    expect(project.repoMachineBindings).toEqual({});
  });

  it('treats legacy autoDeleteTaskWhenDone as cleanup enabled', () => {
    const prefs = resolvedPrefsFromBinding({
      lastOpenedAt: 't',
      repoBindings: { r1: { rootPath: '/x', lastOpenedAt: 't' } },
      primaryRepoId: 'r1',
      autoDeleteTaskWhenDone: true,
    });
    expect(prefs.autoCleanupWorkspaceWhenDone).toBe(true);
  });
});
