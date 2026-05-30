import { describe, expect, it } from 'vitest';
import {
  buildGlobalOnboardingPatch,
  hasPriorAppActivity,
  inferInitialGlobalOnboardingState,
  isForceGlobalOnboardingEnabled,
  migrateGlobalOnboardingFromDisk,
  normalizeGlobalOnboardingState,
  resolveGlobalOnboardingState,
} from './globalOnboardingState';
import { GLOBAL_ONBOARDING_STATE_VERSION } from './types';

const emptyActivity = {
  lastOpenedProjectDir: null,
  activeProjectKey: null,
  projectTabs: {},
  projectLastOpenedAt: {},
};

describe('globalOnboardingState', () => {
  it('normalizes valid v1 state', () => {
    expect(
      normalizeGlobalOnboardingState({
        version: GLOBAL_ONBOARDING_STATE_VERSION,
        status: 'completed',
        selectedAgent: 'cursor',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({
      version: 1,
      status: 'completed',
      selectedAgent: 'cursor',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('rejects unknown version and invalid fields', () => {
    expect(normalizeGlobalOnboardingState({ version: 2, status: 'pending' })).toBeUndefined();
    expect(
      normalizeGlobalOnboardingState({
        version: GLOBAL_ONBOARDING_STATE_VERSION,
        status: 'unknown',
      }),
    ).toBeUndefined();
    expect(
      normalizeGlobalOnboardingState({
        version: GLOBAL_ONBOARDING_STATE_VERSION,
        status: 'pending',
        selectedAgent: 'not-an-agent',
      }),
    ).toBeUndefined();
  });

  it('infers pending for fresh installs and skipped for prior activity', () => {
    expect(inferInitialGlobalOnboardingState(emptyActivity).status).toBe('pending');
    expect(
      inferInitialGlobalOnboardingState({
        ...emptyActivity,
        projectTabs: { 'local:a': { openTaskIds: [], activeTaskId: null } },
      }).status,
    ).toBe('skipped');
  });

  it('migrates missing disk state from activity snapshot', () => {
    expect(migrateGlobalOnboardingFromDisk(undefined, emptyActivity).status).toBe('pending');
    expect(
      migrateGlobalOnboardingFromDisk(undefined, {
        ...emptyActivity,
        lastOpenedProjectDir: '/projects/foo',
      }).status,
    ).toBe('skipped');
    expect(
      migrateGlobalOnboardingFromDisk(
        {
          version: GLOBAL_ONBOARDING_STATE_VERSION,
          status: 'completed',
        },
        emptyActivity,
      ).status,
    ).toBe('completed');
  });

  it('detects prior app activity', () => {
    expect(hasPriorAppActivity(emptyActivity)).toBe(false);
    expect(
      hasPriorAppActivity({
        ...emptyActivity,
        activeProjectKey: { kind: 'cloud', id: 'p1' },
      }),
    ).toBe(true);
  });

  it('honors FLUXX_FORCE_GLOBAL_ONBOARDING', () => {
    expect(isForceGlobalOnboardingEnabled({ FLUXX_FORCE_GLOBAL_ONBOARDING: '1' })).toBe(
      true,
    );
    expect(isForceGlobalOnboardingEnabled({ FLUXX_FORCE_GLOBAL_ONBOARDING: 'true' })).toBe(
      true,
    );
    expect(isForceGlobalOnboardingEnabled({})).toBe(false);
    expect(
      resolveGlobalOnboardingState(
        { version: 1, status: 'skipped' },
        { force: isForceGlobalOnboardingEnabled({ FLUXX_FORCE_GLOBAL_ONBOARDING: '1' }) },
      ),
    ).toEqual({ status: 'pending', forced: true });
  });

  it('buildGlobalOnboardingPatch updates status and agent with timestamp', () => {
    const stored = { version: 1 as const, status: 'pending' as const };
    const next = buildGlobalOnboardingPatch(stored, {
      status: 'completed',
      selectedAgent: 'claude-code',
    });
    expect(next.status).toBe('completed');
    expect(next.selectedAgent).toBe('claude-code');
    expect(next.updatedAt).toMatch(/^\d{4}-/);
  });
});
