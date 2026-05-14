import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_MARK_DONE_WHEN_PR_MERGED,
  DEFAULT_AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN,
  DEFAULT_AUTO_START_SESSION_ON_IN_PROGRESS,
  resolvedPrefsFromBinding,
} from './cloudBindingPrefs';

describe('resolvedPrefsFromBinding', () => {
  it('uses recommended defaults when automation keys are absent', () => {
    const prefs = resolvedPrefsFromBinding({
      lastOpenedAt: 't',
      repoBindings: { r1: { rootPath: '/x', lastOpenedAt: 't' } },
      primaryRepoId: 'r1',
    });
    expect(prefs.autoStartSessionOnInProgress).toBe(DEFAULT_AUTO_START_SESSION_ON_IN_PROGRESS);
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
