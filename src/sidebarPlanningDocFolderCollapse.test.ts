import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  defaultCollapsedPlanningDocFolderPaths,
  hasPlanningDocFolderCollapseStateForProject,
  readCollapsedPlanningDocFolderPathsForProject,
  writeCollapsedPlanningDocFolderPathsForProject,
} from './sidebarPlanningDocFolderCollapse';

describe('sidebarPlanningDocFolderCollapse', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  it('round-trips collapsed folder paths per project', () => {
    writeCollapsedPlanningDocFolderPathsForProject('p1', new Set(['design-docs/active']));
    writeCollapsedPlanningDocFolderPathsForProject('p2', new Set(['sprints']));

    expect(readCollapsedPlanningDocFolderPathsForProject('p1')).toEqual(
      new Set(['design-docs/active']),
    );
    expect(readCollapsedPlanningDocFolderPathsForProject('p2')).toEqual(new Set(['sprints']));
    expect(readCollapsedPlanningDocFolderPathsForProject('p3')).toEqual(new Set());
  });

  it('persists an empty collapsed set as user preference', () => {
    writeCollapsedPlanningDocFolderPathsForProject('p1', new Set(['sprints']));
    writeCollapsedPlanningDocFolderPathsForProject('p1', new Set());
    expect(readCollapsedPlanningDocFolderPathsForProject('p1')).toEqual(new Set());
    expect(hasPlanningDocFolderCollapseStateForProject('p1')).toBe(true);
  });

  it('defaults to collapsing nested folders only', () => {
    expect(
      defaultCollapsedPlanningDocFolderPaths([
        'sprints',
        'design-docs',
        'design-docs/active',
        'design-docs/backlog',
      ]),
    ).toEqual(new Set(['design-docs/active', 'design-docs/backlog']));
  });
});
