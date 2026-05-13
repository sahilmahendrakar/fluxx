import type { Task } from '../types';

type Props = {
  visibleTasks: readonly Task[];
  projectIsEmpty: boolean;
};

/**
 * Placeholder list body for the board tab. Filters match the board via shared
 * {@link applyBoardFilters} upstream in {@link Board}.
 */
export function TaskListSurface({ visibleTasks, projectIsEmpty }: Props) {
  if (projectIsEmpty) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10 text-center text-sm text-zinc-500">
        No tasks yet. Create one from the toolbar to get started.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center">
      <p className="max-w-md text-[13px] leading-relaxed text-zinc-400">
        List layout is selected. Task rows will appear here in a future update; filters
        above still apply —{' '}
        <span className="font-medium text-zinc-300">{visibleTasks.length}</span>{' '}
        {visibleTasks.length === 1 ? 'task matches' : 'tasks match'} the current filters.
      </p>
    </div>
  );
}
