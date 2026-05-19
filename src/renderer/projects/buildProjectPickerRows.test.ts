import { describe, expect, it } from 'vitest';
import type { LocalProject } from '../../types';
import type { CloudProjectSummary } from './cloudProjects';
import {
  buildProjectPickerRows,
  filterProjectPickerRows,
  localProjectPickerSubtitle,
  teamProjectPickerSubtitle,
} from './buildProjectPickerRows';

function localStub(overrides: Partial<LocalProject> & { id: string; name: string }): LocalProject {
  return {
    kind: 'local',
    rootPath: '/tmp/app',
    addedAt: '2026-01-01T00:00:00.000Z',
    planningAgent: 'claude-code',
    defaultTaskAgent: 'claude-code',
    autoStartSessionOnInProgress: false,
    autoRespondToTrustPrompts: false,
    autoStartWhenUnblocked: false,
    autoCleanupWorkspaceWhenDone: false,
    autoMarkDoneWhenPrMerged: false,
    autoMoveToReviewWhenPrOpen: false,
    repos: [{ id: 'r1', rootPath: '/tmp/app', baseBranch: 'main' }],
    ...overrides,
  };
}

function cloudStub(overrides: Partial<CloudProjectSummary> & { id: string; name: string }): CloudProjectSummary {
  return {
    ownerId: 'owner-1',
    memberIds: ['owner-1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildProjectPickerRows', () => {
  it('dedupes local materializations that share a team project id', () => {
    const sharedId = 'cloud-abc';
    const rows = buildProjectPickerRows({
      localProjects: [localStub({ id: sharedId, name: 'On disk' })],
      cloudProjects: [cloudStub({ id: sharedId, name: 'Team name' })],
      uid: 'owner-1',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.variant).toBe('team-synced');
    if (rows[0]?.variant === 'team-synced') {
      expect(rows[0].name).toBe('Team name');
      expect(rows[0].syncBadge).toBe('team-synced');
    }
  });

  it('keeps local-only projects when signed out (no cloud list)', () => {
    const rows = buildProjectPickerRows({
      localProjects: [localStub({ id: 'local-1', name: 'Alpha' })],
      cloudProjects: [],
      uid: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.variant).toBe('local-only');
    if (rows[0]?.variant === 'local-only') {
      expect(rows[0].syncBadge).toBe('local');
    }
  });

  it('sorts rows by most recently opened (newest first)', () => {
    const rows = buildProjectPickerRows({
      localProjects: [localStub({ id: 'local-1', name: 'Local old' })],
      cloudProjects: [cloudStub({ id: 'cloud-1', name: 'Cloud new' })],
      uid: null,
      lastOpenedAtByKey: {
        'local:local-1': '2026-01-01T00:00:00.000Z',
        'cloud:cloud-1': '2026-06-01T00:00:00.000Z',
      },
    });
    expect(rows.map((r) => r.name)).toEqual(['Cloud new', 'Local old']);
  });

  it('filters rows by name and subtitle', () => {
    const rows = buildProjectPickerRows({
      localProjects: [
        localStub({ id: 'a', name: 'Alpha', rootPath: '/tmp/alpha' }),
        localStub({ id: 'b', name: 'Beta', rootPath: '/tmp/beta' }),
      ],
      cloudProjects: [],
      uid: null,
    });
    expect(filterProjectPickerRows(rows, 'beta').map((r) => r.name)).toEqual(['Beta']);
    expect(filterProjectPickerRows(rows, '/tmp/alpha').map((r) => r.name)).toEqual(['Alpha']);
  });
});

describe('localProjectPickerSubtitle', () => {
  it('shows path when repos exist', () => {
    expect(localProjectPickerSubtitle(localStub({ id: 'a', name: 'A' }))).toBe('/tmp/app');
  });

  it('shows empty-repo copy when no repos', () => {
    expect(
      localProjectPickerSubtitle(
        localStub({ id: 'a', name: 'A', repos: [], rootPath: '/Users/me/.fluxx/projects/x' }),
      ),
    ).toBe('No repository yet');
  });
});

describe('teamProjectPickerSubtitle', () => {
  it('labels owner vs member', () => {
    const summary = cloudStub({
      id: 'p',
      name: 'P',
      ownerId: 'owner-1',
      memberIds: ['owner-1', 'm2'],
    });
    expect(teamProjectPickerSubtitle(summary, 'owner-1')).toBe('Owner · 2 members');
    expect(teamProjectPickerSubtitle(summary, 'm2')).toBe('Member · 2 members');
  });
});
