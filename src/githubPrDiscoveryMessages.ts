import type { TaskPrErrorCode, TaskPullRequestIpcResult } from './types';

export type GithubPrDiscoveryMessageContext = 'pending-agent' | 'lookup';

const NO_OPEN_PR_PENDING =
  'No open pull request was found for this task branch yet. The agent may still be committing or opening the PR on GitHub — wait a moment, then click the icon again to check.';

const NO_OPEN_PR_LOOKUP =
  'Still no open pull request for this task branch. Confirm in the session that the agent finished `gh pr create` (or equivalent), then click again.';

const NO_WORKTREE_LOOKUP =
  'No task worktree is available to look up a pull request. Start or resume this task session, then try again.';

/**
 * User-facing copy for `tasks:refreshPullRequest` failures when linking a PR
 * after delegating creation to the task agent (`pending-agent`) versus a
 * deliberate refresh / re-check (`lookup`).
 */
export function formatGithubPrDiscoveryFailure(
  result: Extract<TaskPullRequestIpcResult, { ok: false }>,
  context: GithubPrDiscoveryMessageContext,
): string {
  if (result.code === 'NO_OPEN_PR') {
    return context === 'pending-agent' ? NO_OPEN_PR_PENDING : NO_OPEN_PR_LOOKUP;
  }
  if (result.code === 'NO_WORKTREE') {
    return context === 'pending-agent' ? result.message : NO_WORKTREE_LOOKUP;
  }
  return result.message;
}

/** True when the failure is expected while the agent has not finished opening a PR. */
export function isBenignPrDiscoveryWhileAgentWorking(code: TaskPrErrorCode): boolean {
  return code === 'NO_OPEN_PR' || code === 'NO_WORKTREE';
}

/**
 * Stop timed post-agent PR discovery after errors that are unlikely to resolve with retries
 * (auth, tooling, `gh` view failures, or GitHub rate-limit shaped responses).
 */
export function shouldStopPrAgentFollowupDiscovery(
  code: TaskPrErrorCode,
  message: string,
): boolean {
  if (
    code === 'PR_VIEW_FAILED' ||
    code === 'GH_AUTH_FAILED' ||
    code === 'GH_NOT_INSTALLED' ||
    code === 'NO_GITHUB_REMOTE'
  ) {
    return true;
  }
  const m = message.toLowerCase();
  return (
    m.includes('rate limit') ||
    m.includes('api rate limit') ||
    m.includes('secondary rate limit') ||
    m.includes('http 429') ||
    /\b429\b/.test(m)
  );
}
