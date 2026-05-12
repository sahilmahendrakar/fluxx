import { describe, expect, it } from 'vitest';
import {
  applyBoardFilters,
  boardFiltersAreActive,
  type BoardFilterState,
  UNASSIGNED_ASSIGNEE_VALUE,
  UNLABELED_VALUE,
} from './boardFilter';
import type { Task, TaskStatus } from './types';

function task(
  id: string,
  over: Partial<Task> & { title: string; status: TaskStatus; agent: Task['agent'] },
): Task {
  return {
    id,
    projectId: 'p',
    createdAt: '0',
    ...over,
  };
}

const base: BoardFilterState = {
  search: '',
  includeDescription: true,
  agent: 'all',
  status: 'all',
  label: null,
  assignee: null,
  hideDone: false,
};

describe('applyBoardFilters', () => {
  const list: Task[] = [
    task('1', { title: 'Hello World', status: 'backlog', agent: 'cursor' }),
    task('2', {
      title: 'API',
      description: 'search me subtext',
      status: 'in-progress',
      agent: 'claude-code',
      labels: ['auth', 'x'],
    }),
    task('3', {
      title: 'Z',
      status: 'done',
      agent: 'codex',
      labels: ['Auth'],
    }),
    task('4', { title: 'N', status: 'backlog', agent: 'cursor' }),
    task('5', { title: 'PR up', status: 'review', agent: 'cursor' }),
  ];

  it('returns all when no constraints', () => {
    expect(applyBoardFilters(list, { ...base }).map((x) => x.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });

  it('filters by title search (case-insensitive)', () => {
    expect(
      applyBoardFilters(list, { ...base, search: 'hello' }).map((x) => x.id),
    ).toEqual(['1']);
  });

  it('includes description when enabled', () => {
    expect(
      applyBoardFilters(list, { ...base, search: 'subtext' }).map((x) => x.id),
    ).toEqual(['2']);
  });

  it('excludes description when includeDescription is false', () => {
    expect(
      applyBoardFilters(list, { ...base, search: 'subtext', includeDescription: false })
        .length,
    ).toBe(0);
  });

  it('filters by agent', () => {
    expect(
      applyBoardFilters(list, { ...base, agent: 'claude-code' }).map(
        (x) => x.id,
      ),
    ).toEqual(['2']);
  });

  it('filters by label (case-insensitive match)', () => {
    expect(
      applyBoardFilters(list, { ...base, label: 'auth' }).map((x) => x.id),
    ).toEqual(['2', '3']);
  });

  it('filters to unlabeled only', () => {
    expect(
      applyBoardFilters(list, { ...base, label: UNLABELED_VALUE }).map(
        (x) => x.id,
      ),
    ).toEqual(['1', '4', '5']);
  });

  it('hides done when requested', () => {
    expect(
      applyBoardFilters(list, { ...base, hideDone: true }).map((x) => x.id),
    ).toEqual(['1', '2', '4', '5']);
  });

  it('filters by status column', () => {
    expect(applyBoardFilters(list, { ...base, status: 'review' }).map((x) => x.id)).toEqual([
      '5',
    ]);
  });

  it('filters by assignee id', () => {
    const withAssignees: Task[] = [
      task('a', { title: 'A', status: 'backlog', agent: 'cursor', assigneeId: 'u1' }),
      task('b', { title: 'B', status: 'backlog', agent: 'cursor', assigneeId: 'u2' }),
      task('c', { title: 'C', status: 'backlog', agent: 'cursor' }),
    ];
    expect(
      applyBoardFilters(withAssignees, { ...base, assignee: 'u1' }).map((x) => x.id),
    ).toEqual(['a']);
  });

  it('filters to unassigned only', () => {
    const withAssignees: Task[] = [
      task('a', { title: 'A', status: 'backlog', agent: 'cursor', assigneeId: 'u1' }),
      task('b', { title: 'B', status: 'backlog', agent: 'cursor', assigneeId: null }),
      task('c', { title: 'C', status: 'backlog', agent: 'cursor' }),
    ];
    expect(
      applyBoardFilters(withAssignees, {
        ...base,
        assignee: UNASSIGNED_ASSIGNEE_VALUE,
      }).map((x) => x.id),
    ).toEqual(['b', 'c']);
  });
});

describe('boardFiltersAreActive', () => {
  it('is false for defaults', () => {
    expect(boardFiltersAreActive({ ...base })).toBe(false);
  });

  it('is true when assignee filter is set', () => {
    expect(boardFiltersAreActive({ ...base, assignee: 'u1' })).toBe(true);
    expect(
      boardFiltersAreActive({ ...base, assignee: UNASSIGNED_ASSIGNEE_VALUE }),
    ).toBe(true);
  });
});
