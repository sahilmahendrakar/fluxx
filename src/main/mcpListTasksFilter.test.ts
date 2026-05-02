import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '../types';
import { filterTasksByExcludeStatuses } from './mcpListTasksFilter';

function row(id: string, status: TaskStatus): { id: string; status: TaskStatus } {
  return { id, status };
}

describe('filterTasksByExcludeStatuses', () => {
  const tasks = [row('a', 'backlog'), row('b', 'done'), row('c', 'in-progress')];

  it('returns all tasks when excludeStatuses is omitted', () => {
    expect(filterTasksByExcludeStatuses(tasks)).toEqual(tasks);
  });

  it('returns all tasks when excludeStatuses is empty', () => {
    expect(filterTasksByExcludeStatuses(tasks, [])).toEqual(tasks);
  });

  it('removes tasks whose status is listed', () => {
    expect(filterTasksByExcludeStatuses(tasks, ['done'])).toEqual([tasks[0], tasks[2]]);
  });

  it('supports multiple excluded statuses', () => {
    expect(filterTasksByExcludeStatuses(tasks, ['done', 'in-progress'])).toEqual([tasks[0]]);
  });
});
