import { describe, expect, it, vi } from 'vitest';
import {
  cloudBindingAgentPrefsIfUnset,
  mergeProjectPlanningDefaultsWithGlobal,
  readGlobalOnboardingDefaultAgent,
  readGlobalOnboardingGithubFeaturesEnabled,
  resolveGitIntegrationEnabledForNewProject,
  syncGlobalOnboardingAgentToActiveProject,
} from './globalDefaultAgent';
import { GLOBAL_ONBOARDING_STATE_VERSION } from './types';

describe('readGlobalOnboardingDefaultAgent', () => {
  it('returns selected agent when set', () => {
    expect(
      readGlobalOnboardingDefaultAgent({
        globalOnboarding: {
          version: GLOBAL_ONBOARDING_STATE_VERSION,
          status: 'completed',
          selectedAgent: 'cursor',
        },
      }),
    ).toBe('cursor');
  });

  it('ignores invalid stored agents', () => {
    expect(
      readGlobalOnboardingDefaultAgent({
        globalOnboarding: {
          version: GLOBAL_ONBOARDING_STATE_VERSION,
          status: 'completed',
          selectedAgent: 'invalid' as never,
        },
      }),
    ).toBeUndefined();
  });
});

describe('readGlobalOnboardingGithubFeaturesEnabled', () => {
  it('returns stored preference when boolean', () => {
    expect(
      readGlobalOnboardingGithubFeaturesEnabled({
        globalOnboarding: {
          version: GLOBAL_ONBOARDING_STATE_VERSION,
          status: 'completed',
          githubFeaturesEnabled: false,
        },
      }),
    ).toBe(false);
  });

  it('returns undefined when unset', () => {
    expect(readGlobalOnboardingGithubFeaturesEnabled({})).toBeUndefined();
  });
});

describe('resolveGitIntegrationEnabledForNewProject', () => {
  const input = {
    name: 'Test',
    repos: [{ rootPath: '/tmp/repo' }],
    syncMode: 'local-only' as const,
  };

  it('forces gitless mode when global GitHub features are disabled', async () => {
    const infer = vi.fn(async () => true);
    await expect(
      resolveGitIntegrationEnabledForNewProject(input, false, infer),
    ).resolves.toBe(false);
    expect(infer).not.toHaveBeenCalled();
  });

  it('infers when global preference is true or unset', async () => {
    const infer = vi.fn(async () => true);
    await expect(
      resolveGitIntegrationEnabledForNewProject(input, true, infer),
    ).resolves.toBe(true);
    await expect(
      resolveGitIntegrationEnabledForNewProject(input, undefined, infer),
    ).resolves.toBe(true);
    expect(infer).toHaveBeenCalledTimes(2);
  });
});

describe('mergeProjectPlanningDefaultsWithGlobal', () => {
  it('fills both agents for future local projects when unset', () => {
    expect(mergeProjectPlanningDefaultsWithGlobal(undefined, 'codex')).toEqual({
      planningAgent: 'codex',
      defaultTaskAgent: 'codex',
    });
  });

  it('does not override explicit project defaults', () => {
    expect(
      mergeProjectPlanningDefaultsWithGlobal(
        { planningAgent: 'claude-code', defaultTaskAgent: 'cursor' },
        'codex',
      ),
    ).toEqual({
      planningAgent: 'claude-code',
      defaultTaskAgent: 'cursor',
    });
  });
});

describe('cloudBindingAgentPrefsIfUnset', () => {
  it('seeds both agents on a fresh cloud binding', () => {
    expect(
      cloudBindingAgentPrefsIfUnset(
        { lastOpenedAt: 't', repoBindings: { r1: { rootPath: '/x', lastOpenedAt: 't' } } },
        'cursor',
      ),
    ).toEqual({
      planningAgent: 'cursor',
      defaultTaskAgent: 'cursor',
    });
  });

  it('returns undefined when both agents are already set', () => {
    expect(
      cloudBindingAgentPrefsIfUnset(
        {
          lastOpenedAt: 't',
          planningAgent: 'claude-code',
          defaultTaskAgent: 'codex',
        },
        'cursor',
      ),
    ).toBeUndefined();
  });
});

describe('syncGlobalOnboardingAgentToActiveProject', () => {
  it('no-ops when no project is active', async () => {
    const result = await syncGlobalOnboardingAgentToActiveProject('cursor', {
      activeProjectKey: null,
      setCloudPrefs: vi.fn(),
      setLocalPlanningAgent: vi.fn(),
      setLocalDefaultTaskAgent: vi.fn(),
    });
    expect(result).toEqual({ ok: true });
  });

  it('updates local ProjectStore agents', async () => {
    const setLocalPlanningAgent = vi.fn().mockResolvedValue(undefined);
    const setLocalDefaultTaskAgent = vi.fn().mockResolvedValue(undefined);
    const result = await syncGlobalOnboardingAgentToActiveProject('codex', {
      activeProjectKey: { kind: 'local', id: 'local-1' },
      setCloudPrefs: vi.fn(),
      setLocalPlanningAgent,
      setLocalDefaultTaskAgent,
    });
    expect(result).toEqual({ ok: true });
    expect(setLocalPlanningAgent).toHaveBeenCalledWith('codex');
    expect(setLocalDefaultTaskAgent).toHaveBeenCalledWith('codex');
  });

  it('updates cloud binding prefs', async () => {
    const setCloudPrefs = vi.fn().mockResolvedValue(undefined);
    const result = await syncGlobalOnboardingAgentToActiveProject('cursor', {
      activeProjectKey: { kind: 'cloud', id: 'cloud-1' },
      setCloudPrefs,
      setLocalPlanningAgent: vi.fn(),
      setLocalDefaultTaskAgent: vi.fn(),
    });
    expect(result).toEqual({ ok: true });
    expect(setCloudPrefs).toHaveBeenCalledWith('cloud-1', {
      planningAgent: 'cursor',
      defaultTaskAgent: 'cursor',
    });
  });
});
