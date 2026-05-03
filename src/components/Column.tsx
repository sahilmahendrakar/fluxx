import type { ReactNode } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { Session, Task, TaskStatus } from '../types';
import TaskCard from './TaskCard';
import type { TaskAgentSpawnPatch } from './TaskCardAgentSpawnMenu';
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
  onLabelClick?: (label: string) => void;
  autoStartWhenUnblockedProject: boolean;
  onToggleTaskAutoStartOnUnblock: (taskId: string, enabled: boolean) => void;
  emptyState?: ReactNode;
  membersMap?: Map<string, ProjectMember>;
  /** Cloud: full member list for card footer assignee menu (same source as `membersMap`). */
  projectMembers?: ProjectMember[];
  onTaskAssigneeChange?: (taskId: string, assigneeId: string | null) => void;
  onTaskPrClick?: (taskId: string) => void;
  prLoadingTaskId?: string | null;
  prAgentAwaitingByTaskId?: Record<string, boolean>;
  repoDefaultBranchShort: string;
  cloudUnblockAutostartClientUid?: string;
  sessions: Session[];
  taskHasWorktreeById: Record<string, boolean>;
  onTaskAgentSpawnPrefsChange: (taskId: string, patch: TaskAgentSpawnPatch) => void;
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
  onLabelClick,
  autoStartWhenUnblockedProject,
  onToggleTaskAutoStartOnUnblock,
  emptyState,
  membersMap,
  projectMembers,
  onTaskAssigneeChange,
  onTaskPrClick,
  prLoadingTaskId,
  prAgentAwaitingByTaskId,
  repoDefaultBranchShort,
  cloudUnblockAutostartClientUid,
  sessions,
  taskHasWorktreeById,
  onTaskAgentSpawnPrefsChange,
}: Props) {
  const isNeedsInput = id === 'needs-input';
  const isReview = id === 'review';
  const isDone = id === 'done';

  const headerTint = isNeedsInput
    ? 'text-amber-400/90'
    : isReview
      ? 'text-sky-400/90'
      : isDone
        ? 'text-flux-fg-subtle'
        : 'text-flux-fg-muted';

  const countClass = isNeedsInput
    ? 'bg-amber-500/10 text-amber-400/90 ring-1 ring-amber-500/15'
    : isReview
      ? 'bg-sky-500/10 text-sky-300/95 ring-1 ring-sky-500/18'
      : isDone
        ? 'bg-flux-hover/10 text-flux-fg-subtle ring-1 ring-flux-border/10'
        : 'bg-flux-hover/10 text-flux-fg-subtle ring-1 ring-flux-border/10';

  return (
    <div className="flex min-h-0 min-w-[272px] flex-1 flex-col rounded-lg border border-flux-border/10 bg-flux-elevated/80">
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
            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-flux-fg-subtle transition hover:bg-flux-hover/6 hover:text-flux-fg"
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
            className="flex min-h-0 flex-1 flex-col"
          >
            <div
              className={`flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-3 transition-colors ${
                snapshot.isDraggingOver ? 'bg-flux-hover/4' : ''
              }`}
            >
              {tasks.map((task, index) => {
                const sessionWorktree = sessions.some(
                  (s) => s.taskId === task.id && Boolean(s.worktreePath?.trim()),
                );
                const diskWorktree = taskHasWorktreeById[task.id] === true;
                const hasWorktree = sessionWorktree || diskWorktree;
                return (
                  <TaskCard
                    key={task.id}
                    task={task}
                    allTasks={allTasks}
                    index={index}
                    onDelete={onDeleteTask}
                    onRequestCleanupTask={onRequestCleanupTask}
                    cleanupLoading={cleanupLoadingTaskId === task.id}
                    onCardClick={onCardClick}
                    onLabelClick={onLabelClick}
                    autoStartWhenUnblockedProject={autoStartWhenUnblockedProject}
                    onToggleTaskAutoStartOnUnblock={onToggleTaskAutoStartOnUnblock}
                    assigneeMember={task.assigneeId ? membersMap?.get(task.assigneeId) : undefined}
                    cloudProjectMembers={projectMembers}
                    onTaskAssigneeChange={onTaskAssigneeChange}
                    onTaskPrClick={onTaskPrClick}
                    prLoading={prLoadingTaskId === task.id}
                    prAgentAwaiting={Boolean(prAgentAwaitingByTaskId?.[task.id])}
                    repoDefaultBranchShort={repoDefaultBranchShort}
                    cloudUnblockAutostartClientUid={cloudUnblockAutostartClientUid}
                    hasWorktree={hasWorktree}
                    onTaskAgentSpawnPrefsChange={onTaskAgentSpawnPrefsChange}
                  />
                );
              })}
              {provided.placeholder}
              {tasks.length === 0 && emptyState ? (
                <div className="flex flex-1 items-center justify-center px-3 py-10 text-center text-[13px] leading-relaxed text-flux-fg-subtle">
                  {emptyState}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </Droppable>
    </div>
  );
}
