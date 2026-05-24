import { describe, expect, it } from 'vitest';
import { taskEligibleForGithubPrBoardRefresh } from './githubPrBoardRefreshEligibility';

describe('taskEligibleForGithubPrBoardRefresh', () => {
  it('includes active workflow columns', () => {
    expect(taskEligibleForGithubPrBoardRefresh('in-progress')).toBe(true);
    expect(taskEligibleForGithubPrBoardRefresh('needs-input')).toBe(true);
    expect(taskEligibleForGithubPrBoardRefresh('validation')).toBe(true);
    expect(taskEligibleForGithubPrBoardRefresh('review')).toBe(true);
  });

  it('excludes backlog and done', () => {
    expect(taskEligibleForGithubPrBoardRefresh('backlog')).toBe(false);
    expect(taskEligibleForGithubPrBoardRefresh('done')).toBe(false);
  });
});
