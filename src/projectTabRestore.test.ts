import { describe, expect, it } from 'vitest';
import type { ProjectTabState } from './types';
import { activeProjectKeyString, normalizeRestoredProjectTabState } from './projectTabRestore';

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

  it('filters open tabs to alive daemon sessions only', () => {
    const alive = new Set(['s1', 's2']);
    const out = normalizeRestoredProjectTabState(
      { ...base, openTaskIds: ['s1', 'gone', 's2'] },
      alive,
    );
    expect(out.openTaskIds).toEqual(['s1', 's2']);
  });

  it('restores static active tab ids', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, activeTaskId: 'docs' },
      new Set(),
    );
    expect(out.activeTabId).toBe('docs');
    expect(out.openSettingsRoute).toBe(false);
  });

  it('restores plan: tab when prefix matches (planning session presence checked elsewhere)', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, activeTaskId: 'plan:sess-1' },
      new Set(),
    );
    expect(out.activeTabId).toBe('plan:sess-1');
  });

  it('restores active workspace tab when session is alive', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, openTaskIds: ['live'], activeTaskId: 'live' },
      new Set(['live']),
    );
    expect(out.activeTabId).toBe('live');
  });

  it('falls back to board when active session tab is not alive', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, openTaskIds: [], activeTaskId: 'dead-session' },
      new Set(),
    );
    expect(out.activeTabId).toBe('board');
  });

  it('signals settings route when persisted active was settings', () => {
    const out = normalizeRestoredProjectTabState(
      { ...base, activeTaskId: 'settings' },
      new Set(),
    );
    expect(out.activeTabId).toBe('board');
    expect(out.openSettingsRoute).toBe(true);
  });

  it('carries planning sidebar fields', () => {
    const out = normalizeRestoredProjectTabState(
      {
        ...base,
        openPlanningTabIds: ['p1'],
        planningSidebarActiveSessionId: 'p1',
        planningSidebarOpen: true,
      },
      new Set(),
    );
    expect(out.openPlanningTabIds).toEqual(['p1']);
    expect(out.planningSidebarActiveSessionId).toBe('p1');
    expect(out.planningSidebarOpen).toBe(true);
  });
});
