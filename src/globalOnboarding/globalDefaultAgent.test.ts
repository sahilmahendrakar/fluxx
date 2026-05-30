import { describe, expect, it, vi } from 'vitest';
import {
  cloudBindingAgentPrefsIfUnset,
  mergeProjectPlanningDefaultsWithGlobal,
  readGlobalOnboardingDefaultAgent,
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
