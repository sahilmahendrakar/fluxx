import { describe, expect, it } from 'vitest';
import type { Task } from '../../types';
import {
  buildTaskListRow,
  compareTaskListRows,
  compareTaskListRowsDefault,
  queryTaskListRows,
  queryTaskListRowsFromBoard,
  type TaskListRowBuildContext,
} from './taskListRow';
import { DEFAULT_BOARD_FILTER } from '../../boardFilter';

const baseTask = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Alpha',
  status: 'backlog',
  agent: 'claude-code',
  createdAt: '2024-01-01T00:00:00.000Z',
  projectId: 'p1',
  ...over,
});

const ctx = (
  tasks: Task[],
  over: Partial<TaskListRowBuildContext> = {},
): TaskListRowBuildContext => ({
  allTasks: tasks,
  tasks,
  primaryRepoId: 'repo-primary',
  repoDefaultBranchShort: 'main',
  autoStartWhenUnblockedProject: false,
  ...over,
});

describe('buildTaskListRow', () => {
  it('denormalizes labels, blockers, and assignee display', () => {
    const blocker = baseTask({ id: 'b', title: 'Blocker', status: 'in-progress' });
    const task = baseTask({
      id: 't1',
      labels: ['  Feature ', 'feature', ''],
      blockedByTaskIds: ['b'],
      assigneeId: 'u1',
    });
    const row = buildTaskListRow(task, {
      allTasks: [task, blocker],
      primaryRepoId: 'repo-primary',
      repoDefaultBranchShort: 'main',
      autoStartWhenUnblockedProject: true,
      showRepoBoardUi: false,
      projectRepos: [],
      sessions: [],
      taskHasWorktreeById: {},
      membersByUid: new Map([
        [
          'u1',
          {
            uid: 'u1',
            role: 'member',
            displayName: 'Alex',
            email: 'alex@example.com',
            joinedAt: '1',
            photoURL: 'https://example.com/a.png',
          },
        ],
      ]),
    });
    expect(row.labels).toEqual(['Feature']);
    expect(row.isBlocked).toBe(true);
    expect(row.blockedByCount).toBe(1);
    expect(row.assigneeDisplayName).toBe('Alex');
    expect(row.assigneePhotoUrl).toBe('https://example.com/a.png');
    expect(row.effectiveUnblockAutostart).toBe(true);
  });

  it('counts dependents in blocksCount', () => {
    const parent = baseTask({ id: 'p' });
    const child = baseTask({ id: 'c', blockedByTaskIds: ['p'] });
    const row = buildTaskListRow(parent, {
      allTasks: [parent, child],
      primaryRepoId: 'repo-primary',
      repoDefaultBranchShort: 'main',
      autoStartWhenUnblockedProject: false,
      showRepoBoardUi: false,
      projectRepos: [],
      sessions: [],
      taskHasWorktreeById: {},
    });
    expect(row.blocksCount).toBe(1);
    expect(row.blockedByCount).toBe(0);
  });
});

describe('queryTaskListRows', () => {
  it('sorts by status then orderKey by default', () => {
    const tasks = [
      baseTask({ id: 'a', status: 'done', orderKey: 'a0', title: 'Done task' }),
      baseTask({ id: 'b', status: 'backlog', orderKey: 'b0', title: 'Backlog B' }),
      baseTask({ id: 'c', status: 'backlog', orderKey: 'a0', title: 'Backlog A' }),
    ];
    const rows = queryTaskListRows(ctx(tasks));
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by title when requested', () => {
    const tasks = [
      baseTask({ id: 'z', title: 'Zulu' }),
      baseTask({ id: 'a', title: 'Alpha' }),
    ];
    const rows = queryTaskListRows(ctx(tasks), {
      sort: { key: 'title', direction: 'asc' },
    });
    expect(rows.map((r) => r.id)).toEqual(['a', 'z']);
  });
});

describe('queryTaskListRowsFromBoard', () => {
  it('respects board filters before building rows', () => {
    const tasks = [
      baseTask({ id: 'open', status: 'backlog' }),
      baseTask({ id: 'done', status: 'done' }),
    ];
    const rows = queryTaskListRowsFromBoard(
      tasks,
      { ...DEFAULT_BOARD_FILTER, hideDone: true },
      {
        primaryRepoId: 'repo-primary',
        repoDefaultBranchShort: 'main',
        autoStartWhenUnblockedProject: false,
      },
    );
    expect(rows.map((r) => r.id)).toEqual(['open']);
  });
});

describe('compareTaskListRows', () => {
  it('tie-breaks blockedByCount sort with default ordering', () => {
    const a = buildTaskListRow(baseTask({ id: 'a', blockedByTaskIds: [] }), {
      allTasks: [],
      primaryRepoId: 'r',
      repoDefaultBranchShort: 'main',
      autoStartWhenUnblockedProject: false,
      showRepoBoardUi: false,
      projectRepos: [],
      sessions: [],
      taskHasWorktreeById: {},
    });
    const b = { ...a, id: 'b', blockedByCount: 2 };
    expect(compareTaskListRows(a, b, { key: 'blockedByCount', direction: 'asc' })).toBeLessThan(0);
    expect(compareTaskListRowsDefault(a, b)).toBe(compareTaskListRowsDefault(b, a) * -1 || 0);
  });
});
