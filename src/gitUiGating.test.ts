import { describe, expect, it } from 'vitest';
import {
  shouldShowGithubPrIconButton,
  shouldShowTaskSourceBranchPicker,
} from './gitUiGating';

describe('shouldShowGithubPrIconButton', () => {
  it('returns false when git integration is off', () => {
    expect(
      shouldShowGithubPrIconButton({
        gitEnabled: false,
        hasWorktree: true,
        onTaskPrClick: () => {},
      }),
    ).toBe(false);
  });

  it('returns false without worktree or click handler', () => {
    expect(
      shouldShowGithubPrIconButton({
        gitEnabled: true,
        hasWorktree: false,
        onTaskPrClick: () => {},
      }),
    ).toBe(false);
    expect(
      shouldShowGithubPrIconButton({
        gitEnabled: true,
        hasWorktree: true,
      }),
    ).toBe(false);
  });

  it('returns true when git is on, worktree exists, and handler is set', () => {
    expect(
      shouldShowGithubPrIconButton({
        gitEnabled: true,
        hasWorktree: true,
        onTaskPrClick: () => {},
      }),
    ).toBe(true);
  });
});

describe('shouldShowTaskSourceBranchPicker', () => {
  it('returns false when git integration is off', () => {
    expect(shouldShowTaskSourceBranchPicker(false)).toBe(false);
  });

  it('returns true when git integration is on or unset', () => {
    expect(shouldShowTaskSourceBranchPicker(true)).toBe(true);
    expect(shouldShowTaskSourceBranchPicker(undefined)).toBe(true);
  });
});
