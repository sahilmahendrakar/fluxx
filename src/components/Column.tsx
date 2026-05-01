import type { ReactNode } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { Task, TaskStatus } from '../types';
import TaskCard from './TaskCard';
import type { ProjectMember } from '../renderer/projects/members';

interface Props {
  id: TaskStatus;
  label: string;
  tasks: Task[];
  allTasks: Task[];
  onNewTask?: () => void;
  onDeleteTask: (id: string) => void;
  onRequestCleanupTask?: (id: string) => void;
  cleanupLoadingTaskId?: string | null;
  onCardClick: (id: string) => void;
  autoStartWhenUnblockedProject: boolean;
  onToggleTaskAutoStartOnUnblock: (taskId: string, enabled: boolean) => void;
  emptyState?: ReactNode;
  membersMap?: Map<string, ProjectMember>;
}

export default function Column({
  id,
  label,
  tasks,
  allTasks,
  onNewTask,
  onDeleteTask,
  onRequestCleanupTask,
  cleanupLoadingTaskId,
  onCardClick,
  autoStartWhenUnblockedProject,
  onToggleTaskAutoStartOnUnblock,
  emptyState,
  membersMap,
}: Props) {
  const isNeedsInput = id === 'needs-input';
  const isDone = id === 'done';

  const headerTint = isNeedsInput
    ? 'text-amber-400/90'
    : isDone
      ? 'text-zinc-500'
      : 'text-zinc-400';

  const countClass = isNeedsInput
    ? 'bg-amber-500/10 text-amber-400/90 ring-1 ring-amber-500/15'
    : isDone
      ? 'bg-zinc-800/80 text-zinc-500 ring-1 ring-white/[0.05]'
      : 'bg-zinc-800/80 text-zinc-500 ring-1 ring-white/[0.05]';

  return (
    <div className="flex min-w-[272px] flex-1 flex-col rounded-lg border border-white/[0.06] bg-[#0c0c0e]/80">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2
            className={`truncate text-[11px] font-semibold uppercase tracking-[0.14em] ${headerTint}`}
          >
            {label}
          </h2>
          <span
            className={`inline-flex min-w-[1.25rem] shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${countClass}`}
          >
            {tasks.length}
          </span>
        </div>
        {onNewTask ? (
          <button
            type="button"
            onClick={onNewTask}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-200"
          >
            + New
          </button>
        ) : null}
      </div>
      <Droppable droppableId={id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-3 transition-colors ${
              snapshot.isDraggingOver ? 'bg-white/[0.02]' : ''
            }`}
          >
            {tasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                allTasks={allTasks}
                index={index}
                onDelete={onDeleteTask}
                onRequestCleanupTask={onRequestCleanupTask}
                cleanupLoading={cleanupLoadingTaskId === task.id}
                onCardClick={onCardClick}
                autoStartWhenUnblockedProject={autoStartWhenUnblockedProject}
                onToggleTaskAutoStartOnUnblock={onToggleTaskAutoStartOnUnblock}
                assigneeMember={task.assigneeId ? membersMap?.get(task.assigneeId) : undefined}
              />
            ))}
            {provided.placeholder}
            {tasks.length === 0 && emptyState ? (
              <div className="flex flex-1 items-center justify-center px-3 py-10 text-center text-[13px] leading-relaxed text-zinc-600">
                {emptyState}
              </div>
            ) : null}
          </div>
        )}
      </Droppable>
    </div>
  );
}
