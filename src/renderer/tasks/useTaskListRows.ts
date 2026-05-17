import { useMemo } from 'react';
import {
  queryTaskListRows,
  queryTaskListRowsFromBoard,
  type TaskListRow,
  type TaskListRowBuildContext,
  type TaskListSort,
} from './taskListRow';
import type { ApplyBoardFiltersRepoContext, BoardFilterState } from '../../boardFilter';
import type { Task } from '../../types';

export type UseTaskListRowsInput = TaskListRowBuildContext & {
  sort?: TaskListSort;
};

/**
 * React hook over {@link queryTaskListRows}. Memoizes flat list rows for the
 * list view from the task provider snapshot plus board context.
 */
export function useTaskListRows(input: UseTaskListRowsInput): TaskListRow[] {
  const {
    allTasks,
    tasks,
    primaryRepoId,
    repoDefaultBranchShort,
    autoStartWhenUnblockedProject,
    projectRepos,
    showRepoBoardUi,
    cloudRepoBindingOverview,
    membersByUid,
    sessions,
    taskHasWorktreeById,
    sort,
  } = input;

  return useMemo(
    () =>
      queryTaskListRows(
        {
          allTasks,
          tasks,
          primaryRepoId,
          repoDefaultBranchShort,
          autoStartWhenUnblockedProject,
          projectRepos,
          showRepoBoardUi,
          cloudRepoBindingOverview,
          membersByUid,
          sessions,
          taskHasWorktreeById,
        },
        { sort },
      ),
    [
      allTasks,
      tasks,
      primaryRepoId,
      repoDefaultBranchShort,
      autoStartWhenUnblockedProject,
      projectRepos,
      showRepoBoardUi,
      cloudRepoBindingOverview,
      membersByUid,
      sessions,
      taskHasWorktreeById,
      sort,
    ],
  );
}

export type UseTaskListRowsFromBoardInput = Omit<
  TaskListRowBuildContext,
  'allTasks' | 'tasks'
> & {
  allTasks: readonly Task[];
  boardFilter: BoardFilterState;
  repoFilterContext?: ApplyBoardFiltersRepoContext;
  sort?: TaskListSort;
};

/** Applies {@link queryTaskListRowsFromBoard} with memoization (shared board filters). */
export function useTaskListRowsFromBoard(input: UseTaskListRowsFromBoardInput): TaskListRow[] {
  const {
    allTasks,
    boardFilter,
    repoFilterContext,
    sort,
    primaryRepoId,
    repoDefaultBranchShort,
    autoStartWhenUnblockedProject,
    projectRepos,
    showRepoBoardUi,
    cloudRepoBindingOverview,
    membersByUid,
    sessions,
    taskHasWorktreeById,
  } = input;

  return useMemo(
    () =>
      queryTaskListRowsFromBoard(
        allTasks,
        boardFilter,
        {
          primaryRepoId,
          repoDefaultBranchShort,
          autoStartWhenUnblockedProject,
          projectRepos,
          showRepoBoardUi,
          cloudRepoBindingOverview,
          membersByUid,
          sessions,
          taskHasWorktreeById,
          repoFilterContext,
        },
        { sort },
      ),
    [
      allTasks,
      boardFilter,
      repoFilterContext,
      sort,
      primaryRepoId,
      repoDefaultBranchShort,
      autoStartWhenUnblockedProject,
      projectRepos,
      showRepoBoardUi,
      cloudRepoBindingOverview,
      membersByUid,
      sessions,
      taskHasWorktreeById,
    ],
  );
}
