import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import {
  getBlockingTasks,
  getBlockedTasks,
  isTaskBlocked,
  taskIdsToClearAutoStartOnUnblockWhenAutomationEnables,
  validateBlockedByTaskIds,
  wouldCreateDependencyCycle,
} from './taskDependencies';

const base = (over: Partial<Task> & Pick<Task, 'id' | 'title' | 'status'>): Task => ({
  agent: 'cursor',
  createdAt: '2020-01-01',
  projectId: 'p1',
  ...over,
});

describe('taskIdsToClearAutoStartOnUnblockWhenAutomationEnables', () => {
  it('targets blocked tasks with an override only', () => {
    const a = base({ id: 'a', title: 'A', status: 'in-progress' });
    const blocked = base({
      id: 'b',
      title: 'B',
      status: 'backlog',
      blockedByTaskIds: ['a'],
      autoStartOnUnblock: false,
    });
    const free = base({ id: 'c', title: 'C', status: 'backlog', autoStartOnUnblock: true });
    const all = [a, blocked, free];
    expect(taskIdsToClearAutoStartOnUnblockWhenAutomationEnables(all).sort()).toEqual(['b']);
  });
});

describe('taskDependencies', () => {
  it('getBlockingTasks returns only non-done blockers that exist', () => {
    const a = base({ id: 'a', title: 'A', status: 'in-progress' });
    const b = base({ id: 'b', title: 'B', status: 'done' });
    const c = base({ id: 'c', title: 'C', status: 'backlog' });
    const task = base({
      id: 't',
      title: 'T',
      status: 'backlog',
      blockedByTaskIds: ['a', 'b', 'missing', 'c'],
    });
    const blockers = getBlockingTasks(task, [a, b, c, task]);
    expect(blockers.map((x) => x.id).sort()).toEqual(['a', 'c'].sort());
  });

  it('isTaskBlocked is false when blockers are done or missing', () => {
    const b = base({ id: 'b', title: 'B', status: 'done' });
    const task = base({
      id: 't',
      title: 'T',
      status: 'backlog',
      blockedByTaskIds: ['b', 'ghost'],
    });
    expect(isTaskBlocked(task, [b, task])).toBe(false);
  });

  it('validateBlockedByTaskIds rejects self-dependency', () => {
    const t = base({ id: 't', title: 'T', status: 'backlog' });
    const r = validateBlockedByTaskIds('t', ['t'], [t], false);
    expect(r.ok).toBe(false);
  });

  it('validateBlockedByTaskIds rejects unknown ids in strict mode', () => {
    const t = base({ id: 't', title: 'T', status: 'backlog' });
    const r = validateBlockedByTaskIds('t', ['x'], [t], false);
    expect(r.ok).toBe(false);
  });

  it('validateBlockedByTaskIds allows unknown ids when allowUnknownIds', () => {
    const t = base({ id: 't', title: 'T', status: 'backlog' });
    const r = validateBlockedByTaskIds('t', ['ghost'], [t], true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toEqual(['ghost']);
  });

  it('wouldCreateDependencyCycle detects multi-hop cycle', () => {
    const a = base({ id: 'a', title: 'A', status: 'backlog', blockedByTaskIds: ['b'] });
    const b = base({ id: 'b', title: 'B', status: 'backlog', blockedByTaskIds: ['c'] });
    const c = base({ id: 'c', title: 'C', status: 'backlog', blockedByTaskIds: ['a'] });
    const all = [a, b, c];
    expect(wouldCreateDependencyCycle('a', ['b'], all)).toBe(true);
  });

  it('wouldCreateDependencyCycle allows DAG', () => {
    const a = base({ id: 'a', title: 'A', status: 'backlog' });
    const b = base({ id: 'b', title: 'B', status: 'backlog', blockedByTaskIds: ['a'] });
    const c = base({ id: 'c', title: 'C', status: 'backlog', blockedByTaskIds: ['b'] });
    expect(wouldCreateDependencyCycle('c', ['b'], [a, b, c])).toBe(false);
  });

  it('getBlockedTasks lists dependents', () => {
    const a = base({ id: 'a', title: 'A', status: 'backlog' });
    const b = base({
      id: 'b',
      title: 'B',
      status: 'backlog',
      blockedByTaskIds: ['a'],
    });
    const deps = getBlockedTasks('a', [a, b]);
    expect(deps.map((t) => t.id)).toEqual(['b']);
  });

  it('validateBlockedByTaskIds rejects update that closes a dependency cycle', () => {
    const a = base({ id: 'a', title: 'A', status: 'backlog', blockedByTaskIds: ['b'] });
    const b = base({ id: 'b', title: 'B', status: 'backlog', blockedByTaskIds: ['c'] });
    const c = base({ id: 'c', title: 'C', status: 'backlog', blockedByTaskIds: [] });
    const r = validateBlockedByTaskIds('c', ['a'], [a, b, c], false);
    expect(r.ok).toBe(false);
  });
});
