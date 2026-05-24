import { describe, expect, it } from 'vitest';
import type { ProjectTabState } from './types';
import type { PlanningSession } from './types';
import {
  activeProjectKeyString,
  filterSessionsForWorkspaceSidebar,
  mergeSessionsWithRestoringPlaceholders,
  normalizeRestoredProjectTabState,
  resolvePlanningSidebarActiveId,
  restorableSessionIdSets,
} from './projectTabRestore';

describe('activeProjectKeyString', () => {
  it('matches main process projectStateKey format', () => {
    expect(activeProjectKeyString({ kind: 'local', id: 'abc' })).toBe('local:abc');
    expect(activeProjectKeyString({ kind: 'cloud', id: 'xyz' })).toBe('cloud:xyz');
  });
});

describe('normalizeRestoredProjectTabState', () => {
  const base: ProjectTabState = {
    openTaskIds: [],
    activeTaskId: null,
  };

  const restorable = (task: string[], planning: string[] = []) =>
    restorableSessionIdSets({ taskSessionIds: task, planningSessionIds: planning });

  it('filters open tabs to restorable task session ids only', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, openTaskIds: ['s1', 'gone', 's2'] },
      restorable(['s1', 's2']),
    );
    expect(out.openTaskIds).toEqual(['s1', 's2']);
  });

  it('keeps cold-resumable task tabs not present in live getAll', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, openTaskIds: ['cold-only'], activeTaskId: 'cold-only' },
      restorable(['cold-only']),
    );
    expect(out.openTaskIds).toEqual(['cold-only']);
    expect(out.activeTabId).toBe('cold-only');
  });

  it('restores static active tab ids', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, activeTaskId: 'docs' },
      restorable([]),
    );
    expect(out.activeTabId).toBe('docs');
    expect(out.openSettingsRoute).toBe(false);
  });

  it('restores plan: tab when planning session is restorable', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, activeTaskId: 'plan:sess-1' },
      restorable([], ['sess-1']),
    );
    expect(out.activeTabId).toBe('plan:sess-1');
  });

  it('falls back to board when plan tab is not restorable', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, activeTaskId: 'plan:gone' },
      restorable([]),
    );
    expect(out.activeTabId).toBe('board');
  });

  it('restores active workspace tab when session is restorable', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, openTaskIds: ['live'], activeTaskId: 'live' },
      restorable(['live']),
    );
    expect(out.activeTabId).toBe('live');
  });

  it('falls back to board when active session tab is not restorable', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, openTaskIds: [], activeTaskId: 'dead-session' },
      restorable([]),
    );
    expect(out.activeTabId).toBe('board');
  });

  it('signals settings route when persisted active was settings', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, activeTaskId: 'settings' },
      restorable([]),
    );
    expect(out.activeTabId).toBe('board');
    expect(out.openSettingsRoute).toBe(true);
  });

  it('carries planning sidebar fields when session is restorable', () => {
    const out = normalizeRestoredProjectTabState(
      {
        ...base,
        openPlanningTabIds: ['p1', 'stale'],
        planningSidebarActiveSessionId: 'p1',
        planningSidebarOpen: true,
      },
      restorable([], ['p1']),
    );
    expect(out.openPlanningTabIds).toEqual(['p1']);
    expect(out.planningSidebarActiveSessionId).toBe('p1');
    expect(out.planningSidebarOpen).toBe(true);
    expect(out.minimizedTaskWorkspaceIds).toEqual([]);
  });

  it('clears planning sidebar active when session is not restorable', () => {
    const out = normalizeRestoredProjectTabState(
      {
        ...base,
        planningSidebarActiveSessionId: 'gone',
        planningSidebarOpen: true,
      },
      restorable([]),
    );
    expect(out.planningSidebarActiveSessionId).toBeNull();
  });

  it('filters minimized workspace ids to restorable task sessions only', () => {
    const out = normalizeRestoredProjectTabState(
      {
        ...base,
        minimizedTaskWorkspaceIds: ['s1', 'gone', 's2'],
      },
      restorable(['s1', 's2']),
    );
    expect(out.minimizedTaskWorkspaceIds).toEqual(['s1', 's2']);
  });

  it('keeps minimized ids independently of open workspace tabs', () => {
    const out = normalizeRestoredProjectTabState(
      {
        ...base,
        openTaskIds: [],
        minimizedTaskWorkspaceIds: ['s1', 'gone'],
        activeTaskId: 'board',
      },
      restorable(['s1']),
    );
    expect(out.openTaskIds).toEqual([]);
    expect(out.minimizedTaskWorkspaceIds).toEqual(['s1']);
  });
});

describe('resolvePlanningSidebarActiveId', () => {
  const restorable = (task: string[], planning: string[] = []) =>
    restorableSessionIdSets({ taskSessionIds: task, planningSessionIds: planning });

  const planningRow = (id: string, status: PlanningSession['status'] = 'interrupted'): PlanningSession => ({
    id,
    projectId: 'p1',
    agent: 'cursor',
    planningDir: '/tmp/plan',
    status,
    startedAt: '2026-01-01T00:00:00.000Z',
    stoppedAt: '2026-01-01T01:00:00.000Z',
  });

  it('uses normalized active id when present', () => {
    const id = resolvePlanningSidebarActiveId(
      { openTaskIds: [], activeTaskId: null, planningSidebarActiveSessionId: 'p1' },
      [planningRow('p1')],
      { planningSidebarActiveSessionId: 'p1', planningSidebarOpen: true },
    );
    expect(id).toBe('p1');
  });

  it('falls back to persisted id once planning.list includes the session', () => {
    const persisted = {
      openTaskIds: [],
      activeTaskId: null,
      planningSidebarActiveSessionId: 'p1',
      planningSidebarOpen: true,
    };
    const normalized = normalizeRestoredProjectTabState(persisted, restorable([]));
    const id = resolvePlanningSidebarActiveId(persisted, [planningRow('p1')], normalized);
    expect(id).toBe('p1');
  });

  it('does not pick a running-only session for sidebar active', () => {
    const persisted = {
      openTaskIds: [],
      activeTaskId: null,
      planningSidebarOpen: true,
    };
    const normalized = normalizeRestoredProjectTabState(persisted, restorable([]));
    const id = resolvePlanningSidebarActiveId(
      persisted,
      [planningRow('live-1', 'running')],
      normalized,
    );
    expect(id).toBeNull();
  });

  it('picks the only interrupted session when sidebar was open without active id', () => {
    const persisted = {
      openTaskIds: [],
      activeTaskId: null,
      planningSidebarOpen: true,
    };
    const normalized = normalizeRestoredProjectTabState(persisted, restorable([]));
    const id = resolvePlanningSidebarActiveId(
      persisted,
      [planningRow('cold-1')],
      normalized,
    );
    expect(id).toBe('cold-1');
  });
});

describe('normalizeRestoredProjectTabState keepPersistedOpenTaskIds', () => {
  it('keeps persisted open tabs before restorable ids are known', () => {
    const out = normalizeRestoredProjectTabState(
      { openTaskIds: ['ssh-s1'], activeTaskId: 'ssh-s1' },
      { taskSessionIds: new Set(), planningSessionIds: new Set() },
      { keepPersistedOpenTaskIds: true },
    );
    expect(out.openTaskIds).toEqual(['ssh-s1']);
    expect(out.activeTabId).toBe('ssh-s1');
  });
});

describe('mergeSessionsWithRestoringPlaceholders', () => {
  it('adds placeholder rows for open tabs missing from getAll', () => {
    const merged = mergeSessionsWithRestoringPlaceholders(
      [],
      new Set(['pending-s1']),
      new Set(),
      'p1',
      new Map([['pending-s1', 'task-1']]),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('pending-s1');
    expect(merged[0]?.taskId).toBe('task-1');
    expect(merged[0]?.status).toBe('idle');
  });
});

describe('filterSessionsForWorkspaceSidebar', () => {
  const baseSession = (id: string, taskId: string): import('./types').Session => ({
    id,
    taskId,
    projectId: 'p1',
    status: 'interrupted',
    startedAt: '2026-01-01T00:00:00.000Z',
  });

  it('keeps open tabs and running sessions only', () => {
    const sessions = [
      baseSession('open', 't1'),
      baseSession('orphan', 't2'),
      { ...baseSession('live', 't3'), status: 'running' },
    ];
    const out = filterSessionsForWorkspaceSidebar(
      sessions,
      'p1',
      new Set(['open']),
      new Set(),
    );
    expect(out.map((s) => s.id).sort()).toEqual(['live', 'open']);
  });
});
