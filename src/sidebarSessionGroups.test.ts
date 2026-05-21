import { describe, expect, it } from 'vitest';
import {
  buildSidebarSessionLayout,
  effectiveSessionRepoId,
} from './sidebarSessionGroups';
import type { SessionTabMeta } from './components/TabBar';

const repos = [
  { id: 'repo-a', name: 'Service A', rootPath: '/a' },
  { id: 'repo-b', name: 'Service B', rootPath: '/b' },
] as const;

function item(
  sessionId: string,
  taskId: string,
  repoId?: string,
  title = 'Task',
): SessionTabMeta {
  return {
    session: {
      id: sessionId,
      taskId,
      projectId: 'p1',
      repoId,
      worktreePath: '/wt',
      branch: 'main',
      status: 'running',
      startedAt: '',
    },
    title,
  };
}

describe('sidebarSessionGroups', () => {
  it('effectiveSessionRepoId prefers session.repoId, then task, then primary', () => {
    expect(
      effectiveSessionRepoId({ repoId: 'repo-b', taskId: 't1' }, { repoId: 'repo-a' }, 'repo-a'),
    ).toBe('repo-b');
    expect(effectiveSessionRepoId({ taskId: 't1' }, { repoId: 'repo-b' }, 'repo-a')).toBe('repo-b');
    expect(effectiveSessionRepoId({ taskId: 't1' }, undefined, 'repo-a')).toBe('repo-a');
  });

  it('returns flat layout for a single configured repo', () => {
    const layout = buildSidebarSessionLayout({
      sessions: [item('s1', 't1')],
      repos: [{ id: 'repo-a', name: 'Only', rootPath: '/a' }],
      tasks: [{ id: 't1', repoId: 'repo-a' }],
    });
    expect(layout).toEqual({
      kind: 'flat',
      items: [expect.objectContaining({ session: expect.objectContaining({ id: 's1' }) })],
    });
  });

  it('groups by repo in project order and hides empty repo sections', () => {
    const layout = buildSidebarSessionLayout({
      sessions: [
        item('s2', 't2', 'repo-b', 'B task'),
        item('s1', 't1', 'repo-a', 'A task'),
      ],
      repos: [...repos],
      tasks: [
        { id: 't1', repoId: 'repo-a' },
        { id: 't2', repoId: 'repo-b' },
      ],
    });
    expect(layout.kind).toBe('grouped');
    if (layout.kind !== 'grouped') return;
    expect(layout.groups.map((g) => g.repoId)).toEqual(['repo-a', 'repo-b']);
    expect(layout.groups[0]?.items.map((i) => i.session.id)).toEqual(['s1']);
    expect(layout.groups[1]?.items.map((i) => i.session.id)).toEqual(['s2']);
    expect(layout.groups[0]?.label).toBe('Service A');
  });

  it('resolves repo from task when session.repoId is missing', () => {
    const layout = buildSidebarSessionLayout({
      sessions: [item('s1', 't1', undefined, 'From task')],
      repos: [...repos],
      tasks: [{ id: 't1', repoId: 'repo-b' }],
    });
    expect(layout.kind).toBe('grouped');
    if (layout.kind !== 'grouped') return;
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0]?.repoId).toBe('repo-b');
  });

  it('appends unknown repo buckets after configured repos', () => {
    const layout = buildSidebarSessionLayout({
      sessions: [item('s1', 't1', 'orphan')],
      repos: [...repos],
      tasks: [{ id: 't1', repoId: 'orphan' }],
    });
    expect(layout.kind).toBe('grouped');
    if (layout.kind !== 'grouped') return;
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0]?.repoId).toBe('orphan');
    expect(layout.groups[0]?.label).toMatch(/^repo:/);
  });
});
