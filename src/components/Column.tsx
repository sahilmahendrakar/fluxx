import type { ReactNode } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import {
  Session,
  Task,
  TaskStatus,
  type CloudRepoBindingOverview,
  type ExecutionDeviceConfig,
  type RepoConfig,
  type TaskExecutionDeviceRef,
} from '../types';
import {
  findRepoByIdOrPrimary,
  repoChipTooltipText,
  repoDisplayLabel,
} from '../repoIdentity';
import { normalizeGitBranchShortName } from '../taskBranches';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import TaskCard from './TaskCard';
import type { TaskAgentSpawnPatch } from './TaskCardAgentSpawnMenu';
import type { TaskPatch } from '../renderer/tasks/TaskProvider';
import type { ProjectMember } from '../renderer/projects/members';
import { selectSessionForTaskWorkspace } from '../sessionWorkspacePick';
import type { ExecutionDeviceDefaults } from '../hooks/useExecutionDeviceDefaults';

interface Props {
  id: TaskStatus;
  label: string;
  tasks: Task[];
  allTasks: Task[];
  onNewTask?: () => void;
  onDeleteTask: (id: string, opts?: { closeDetail?: boolean }) => void;
  onRequestCleanupTask?: (id: string) => void;
  cleanupLoadingTaskId?: string | null;
  onCardClick: (id: string) => void;
  onLabelClick?: (label: string) => void;
  autoStartWhenUnblockedProject: boolean;
  validationEnabledProject: boolean;
  onPatchTaskAutoStartOnUnblock: (taskId: string, patch: Pick<TaskPatch, 'autoStartOnUnblock'>) => void;
  emptyState?: ReactNode;
  membersMap?: Map<string, ProjectMember>;
  /** Cloud: full member list for card footer assignee menu (same source as `membersMap`). */
  projectMembers?: ProjectMember[];
  onTaskAssigneeChange?: (taskId: string, assigneeId: string | null) => void;
  onTaskPrClick?: (taskId: string) => void;
  prLoadingTaskId?: string | null;
  prAgentAwaitingByTaskId?: Record<string, boolean>;
  repoDefaultBranchShort: string;
  /** Multi-repo board: repo chips + repo-scoped branch default from {@link RepoConfig.baseBranch}. */
  showRepoBoardUi?: boolean;
  projectRepos?: RepoConfig[];
  cloudRepoBindingOverview?: CloudRepoBindingOverview;
  cloudUnblockAutostartClientUid?: string;
  sessions: Session[];
  taskHasWorktreeById: Record<string, boolean>;
  /** When false, hides PR controls and branch chips (gitless project). Defaults to on. */
  gitEnabled?: boolean;
  onTaskAgentSpawnPrefsChange: (taskId: string, patch: TaskAgentSpawnPatch) => void;
  onTaskExecutionDeviceChange: (taskId: string, ref: TaskExecutionDeviceRef) => void;
  onOpenTaskWorkspaceTab: (taskId: string) => void;
  executionDevices?: ExecutionDeviceConfig[];
  executionDeviceDefaults?: ExecutionDeviceDefaults;
  cloudProject?: boolean;
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
  validationEnabledProject,
  onPatchTaskAutoStartOnUnblock,
  emptyState,
  membersMap,
  projectMembers,
  onTaskAssigneeChange,
  onTaskPrClick,
  prLoadingTaskId,
  prAgentAwaitingByTaskId,
  repoDefaultBranchShort,
  showRepoBoardUi = false,
  projectRepos,
  cloudRepoBindingOverview,
  cloudUnblockAutostartClientUid,
  sessions,
  taskHasWorktreeById,
  gitEnabled = true,
  onTaskAgentSpawnPrefsChange,
  onTaskExecutionDeviceChange,
  onOpenTaskWorkspaceTab,
  executionDevices,
  executionDeviceDefaults,
  cloudProject,
}: Props) {
  const isNeedsInput = id === 'needs-input';
  const isValidation = id === 'validation';
  const isReview = id === 'review';
  const headerTint = isNeedsInput
    ? 'text-status-needs-input'
    : isValidation
      ? 'text-status-validation'
      : isReview
        ? 'text-status-review'
        : 'text-foreground/80 dark:text-muted-foreground';

  const countClass = isNeedsInput
    ? 'border-status-needs-input/25 bg-status-needs-input/15 text-status-needs-input-foreground'
    : isValidation
      ? 'border-status-validation/25 bg-status-validation/15 text-status-validation dark:text-status-validation-foreground'
      : isReview
        ? 'border-status-review/25 bg-status-review/15 text-status-review-foreground'
        : 'border-border bg-muted/60 text-foreground/78 dark:text-muted-foreground';

  return (
    <div className="flex min-h-0 min-w-[272px] flex-1 flex-col rounded-xl border border-border/70 bg-muted/15 dark:bg-background">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2
            className={cn(
              'truncate text-[11px] font-semibold uppercase tracking-[0.14em]',
              headerTint,
            )}
          >
            {label}
          </h2>
          <span
            className={cn(
              'inline-flex min-w-[1.25rem] shrink-0 items-center justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
              countClass,
            )}
          >
            {tasks.length}
          </span>
        </div>
        {onNewTask ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] text-foreground/78 dark:text-muted-foreground"
            onClick={onNewTask}
          >
            + New
          </Button>
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
              className={cn(
                'flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-3 transition-colors',
                snapshot.isDraggingOver && 'bg-muted/25 dark:bg-accent/40',
              )}
            >
              {tasks.map((task, index) => {
                const sessionWorktree = sessions.some(
                  (s) => s.taskId === task.id && Boolean(s.worktreePath?.trim()),
                );
                const diskWorktree = taskHasWorktreeById[task.id] === true;
                const hasWorktree = sessionWorktree || diskWorktree;
                const taskWorkspaceSession = selectSessionForTaskWorkspace(sessions, task.id);
                const canOpenTaskWorkspaceTab = taskWorkspaceSession !== undefined;
                const effectiveRepo =
                  showRepoBoardUi && projectRepos?.length
                    ? findRepoByIdOrPrimary(projectRepos, task.repoId)
                    : undefined;
                const repoChip =
                  showRepoBoardUi && effectiveRepo
                    ? {
                        label: repoDisplayLabel(effectiveRepo),
                        title: repoChipTooltipText(
                          effectiveRepo,
                          cloudRepoBindingOverview?.[effectiveRepo.id],
                        ),
                      }
                    : undefined;
                const branchChipCompareShort =
                  showRepoBoardUi && effectiveRepo
                    ? normalizeGitBranchShortName(effectiveRepo.baseBranch || 'main')
                    : undefined;
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
                    validationEnabledProject={validationEnabledProject}
                    onPatchTaskAutoStartOnUnblock={onPatchTaskAutoStartOnUnblock}
                    assigneeMember={task.assigneeId ? membersMap?.get(task.assigneeId) : undefined}
                    cloudProjectMembers={projectMembers}
                    onTaskAssigneeChange={onTaskAssigneeChange}
                    onTaskPrClick={onTaskPrClick}
                    prLoading={prLoadingTaskId === task.id}
                    prAgentAwaiting={Boolean(prAgentAwaitingByTaskId?.[task.id])}
                    repoDefaultBranchShort={repoDefaultBranchShort}
                    branchChipCompareShort={branchChipCompareShort}
                    repoChip={repoChip}
                    cloudUnblockAutostartClientUid={cloudUnblockAutostartClientUid}
                    hasWorktree={hasWorktree}
                    gitEnabled={gitEnabled}
                    onTaskAgentSpawnPrefsChange={onTaskAgentSpawnPrefsChange}
                    onTaskExecutionDeviceChange={onTaskExecutionDeviceChange}
                    taskWorkspaceSessionStatus={taskWorkspaceSession?.status}
                    canOpenTaskWorkspaceTab={canOpenTaskWorkspaceTab}
                    onOpenTaskWorkspaceTab={onOpenTaskWorkspaceTab}
                    executionDevices={executionDevices}
                    executionDeviceDefaults={executionDeviceDefaults}
                    cloudProject={cloudProject}
                  />
                );
              })}
              {provided.placeholder}
              {tasks.length === 0 && emptyState ? (
                <div className="flex flex-1 items-center justify-center px-3 py-10 text-center text-[13px] leading-relaxed text-muted-foreground">
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
