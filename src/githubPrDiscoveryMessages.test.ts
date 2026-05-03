import { describe, expect, it } from 'vitest';
import {
  formatGithubPrDiscoveryFailure,
  isBenignPrDiscoveryWhileAgentWorking,
  shouldStopPrAgentFollowupDiscovery,
} from './githubPrDiscoveryMessages';

describe('formatGithubPrDiscoveryFailure', () => {
  it('uses softer copy for NO_OPEN_PR while agent may still be working', () => {
    const msg = formatGithubPrDiscoveryFailure(
      { ok: false, code: 'NO_OPEN_PR', message: 'No open pull request found for this task worktree' },
      'pending-agent',
    );
    expect(msg).toContain('No open pull request');
    expect(msg).toContain('agent may still be');
  });

  it('uses direct copy for NO_OPEN_PR on explicit lookup', () => {
    const msg = formatGithubPrDiscoveryFailure(
      { ok: false, code: 'NO_OPEN_PR', message: 'No open pull request found for this task worktree' },
      'lookup',
    );
    expect(msg).toContain('Still no open pull request');
  });

  it('passes through gh-style failures unchanged', () => {
    const msg = formatGithubPrDiscoveryFailure(
      { ok: false, code: 'GH_AUTH_FAILED', message: 'HTTP 401: Bad credentials' },
      'lookup',
    );
    expect(msg).toBe('HTTP 401: Bad credentials');
  });
});

describe('isBenignPrDiscoveryWhileAgentWorking', () => {
  it('treats NO_OPEN_PR and NO_WORKTREE as benign', () => {
    expect(isBenignPrDiscoveryWhileAgentWorking('NO_OPEN_PR')).toBe(true);
    expect(isBenignPrDiscoveryWhileAgentWorking('NO_WORKTREE')).toBe(true);
    expect(isBenignPrDiscoveryWhileAgentWorking('GH_AUTH_FAILED')).toBe(false);
  });
});

describe('shouldStopPrAgentFollowupDiscovery', () => {
  it('stops after PR_VIEW_FAILED and auth/tooling errors', () => {
    expect(shouldStopPrAgentFollowupDiscovery('PR_VIEW_FAILED', 'gh failed')).toBe(true);
    expect(shouldStopPrAgentFollowupDiscovery('GH_AUTH_FAILED', 'nope')).toBe(true);
    expect(shouldStopPrAgentFollowupDiscovery('GH_NOT_INSTALLED', '')).toBe(true);
    expect(shouldStopPrAgentFollowupDiscovery('NO_OPEN_PR', '')).toBe(false);
  });

  it('detects rate-limit shaped messages', () => {
    expect(
      shouldStopPrAgentFollowupDiscovery('NO_OPEN_PR', 'GitHub API rate limit exceeded'),
    ).toBe(true);
    expect(shouldStopPrAgentFollowupDiscovery('PR_CREATE_FAILED', 'HTTP 429: too many')).toBe(
      true,
    );
  });
});
