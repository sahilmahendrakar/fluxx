import { describe, expect, it } from 'vitest';
import type { LocalProject } from '../types';
import { buildPickerLastOpenedAtMap } from './projectPickerLastOpened';

function localStub(id: string, addedAt: string): LocalProject {
  return {
    kind: 'local',
    id,
    name: id,
    rootPath: '/tmp',
    addedAt,
    planningAgent: 'claude-code',
    defaultTaskAgent: 'claude-code',
    autoStartSessionOnInProgress: false,
    autoRespondToTrustPrompts: false,
    autoStartWhenUnblocked: false,
    autoCleanupWorkspaceWhenDone: false,
    autoMarkDoneWhenPrMerged: false,
    autoMoveToReviewWhenPrOpen: false,
    persistTerminalsWithTmux: false,
    validationEnabled: false,
    gitIntegrationEnabled: true,
    gitlessSingleSessionPerFolder: true,
    repos: [],
  };
}

describe('buildPickerLastOpenedAtMap', () => {
  it('merges app state, local addedAt, and cloud binding times', () => {
    const map = buildPickerLastOpenedAtMap({
      appStateStore: {
        get: () => ({
          lastOpenedProjectDir: null,
          activeProjectKey: null,
          projectTabs: {},
          projectLastOpenedAt: { 'local:local-1': '2026-03-01T00:00:00.000Z' },
        }),
      } as never,
      bindingStore: {
        getLastOpenedAtByProjectId: () => ({
          'cloud-1': '2026-05-01T00:00:00.000Z',
        }),
      } as never,
      localProjects: [localStub('local-1', '2026-01-01T00:00:00.000Z')],
    });
    expect(map['local:local-1']).toBe('2026-03-01T00:00:00.000Z');
    expect(map['cloud:cloud-1']).toBe('2026-05-01T00:00:00.000Z');
  });
});
