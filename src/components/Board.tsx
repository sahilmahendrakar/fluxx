import { useMemo } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import {
  Session,
  Task,
  TaskStatus,
  boardColumns,
  type CloudRepoBindingOverview,
  type ExecutionDeviceConfig,
  type RepoConfig,
  type TaskExecutionDeviceRef,
} from '../types';
import type { ProjectMember } from '../renderer/projects/members';
import Column from './Column';
import type { TaskAgentSpawnPatch } from './TaskCardAgentSpawnMenu';
import type { TaskPatch } from '../renderer/tasks/TaskProvider';
import type { ExecutionDeviceDefaults } from '../hooks/useExecutionDeviceDefaults';
import type { ProjectRepoReadiness } from '../projectRepoReadiness';

interface Props {
  allTasks: Task[];
  visibleTasks: Task[];
  onDragEnd: (result: DropResult) => void;
  onDeleteTask: (id: string, opts?: { closeDetail?: boolean }) => void;
  onRequestCleanupTask: (id: string) => void;
  cleanupLoadingTaskId: string | null;
  onCardClick: (id: string) => void;
  onLabelClick: (label: string) => void;
  onRequestNewTask: () => void;
  autoStartWhenUnblockedProject: boolean;
  validationEnabledProject: boolean;
  onPatchTaskAutoStartOnUnblock: (taskId: string, patch: Pick<TaskPatch, 'autoStartOnUnblock'>) => void;
  projectMembers?: ProjectMember[];
  onTaskAssigneeChange?: (taskId: string, assigneeId: string | null) => void;
  onTaskPrClick?: (taskId: string) => void;
  prLoadingTaskId?: string | null;
  prAgentAwaitingByTaskId?: Record<string, boolean>;
  repoDefaultBranchShort: string;
  showRepoBoardUi: boolean;
  projectRepos?: RepoConfig[];
  cloudRepoBindingOverview?: CloudRepoBindingOverview;
  cloudUnblockAutostartClientUid?: string;
  sessions: Session[];
  taskHasWorktreeById: Record<string, boolean>;
  onTaskAgentSpawnPrefsChange: (taskId: string, patch: TaskAgentSpawnPatch) => void;
  onTaskExecutionDeviceChange: (taskId: string, ref: TaskExecutionDeviceRef) => void;
  onOpenTaskWorkspaceTab: (taskId: string) => void;
  executionDevices?: ExecutionDeviceConfig[];
  executionDeviceDefaults?: ExecutionDeviceDefaults;
  cloudProject?: boolean;
  projectIsEmpty: boolean;
  noMatches: boolean;
  filtersActive: boolean;
  repoActionsBlocked: boolean;
  projectRepoReadiness: ProjectRepoReadiness;
}

export default function Board({
  allTasks,
  visibleTasks,
  onDragEnd,
  onDeleteTask,
  onRequestCleanupTask,
  cleanupLoadingTaskId,
  onCardClick,
  onLabelClick,
  onRequestNewTask,
  autoStartWhenUnblockedProject,
  validationEnabledProject,
  onPatchTaskAutoStartOnUnblock,
  projectMembers,
  onTaskAssigneeChange,
  onTaskPrClick,
  prLoadingTaskId,
  prAgentAwaitingByTaskId,
  repoDefaultBranchShort,
  showRepoBoardUi,
  projectRepos,
  cloudRepoBindingOverview,
  cloudUnblockAutostartClientUid,
  sessions,
  taskHasWorktreeById,
  onTaskAgentSpawnPrefsChange,
  onTaskExecutionDeviceChange,
  onOpenTaskWorkspaceTab,
  executionDevices,
  executionDeviceDefaults,
  cloudProject = false,
  projectIsEmpty,
  noMatches,
  filtersActive,
  repoActionsBlocked,
  projectRepoReadiness,
}: Props) {
  const membersMap = useMemo(() => {
    if (!projectMembers) return undefined;
    return new Map<string, ProjectMember>(
      projectMembers.map((member) => [member.uid, member]),
    );
  }, [projectMembers]);

  const visibleColumns = useMemo(
    () => boardColumns(validationEnabledProject),
    [validationEnabledProject],
  );

  const tasksByStatus = useMemo(() => {
    const by = {} as Record<TaskStatus, Task[]>;
    for (const c of visibleColumns) {
      by[c.id] = [];
    }
    for (const task of visibleTasks) {
      if (by[task.status]) {
        by[task.status].push(task);
      }
    }
    return by;
  }, [visibleTasks, visibleColumns]);

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden p-4">
        {visibleColumns.map((col) => (
          <Column
            key={col.id}
            id={col.id}
            label={col.label}
            tasks={tasksByStatus[col.id]}
            allTasks={allTasks}
            onNewTask={
              col.id === 'backlog' && !repoActionsBlocked
                ? onRequestNewTask
                : undefined
            }
            onDeleteTask={onDeleteTask}
            onRequestCleanupTask={col.id === 'done' ? onRequestCleanupTask : undefined}
            cleanupLoadingTaskId={col.id === 'done' ? cleanupLoadingTaskId : null}
            onCardClick={onCardClick}
            onLabelClick={onLabelClick}
            autoStartWhenUnblockedProject={autoStartWhenUnblockedProject}
            validationEnabledProject={validationEnabledProject}
            onPatchTaskAutoStartOnUnblock={onPatchTaskAutoStartOnUnblock}
            membersMap={membersMap}
            projectMembers={projectMembers}
            onTaskAssigneeChange={onTaskAssigneeChange}
            onTaskPrClick={onTaskPrClick}
            prLoadingTaskId={prLoadingTaskId}
            prAgentAwaitingByTaskId={prAgentAwaitingByTaskId}
            repoDefaultBranchShort={repoDefaultBranchShort}
            showRepoBoardUi={showRepoBoardUi}
            projectRepos={projectRepos}
            cloudRepoBindingOverview={cloudRepoBindingOverview}
            cloudUnblockAutostartClientUid={cloudUnblockAutostartClientUid}
            sessions={sessions}
            taskHasWorktreeById={taskHasWorktreeById}
            onTaskAgentSpawnPrefsChange={onTaskAgentSpawnPrefsChange}
            onTaskExecutionDeviceChange={onTaskExecutionDeviceChange}
            onOpenTaskWorkspaceTab={onOpenTaskWorkspaceTab}
            executionDevices={executionDevices}
            executionDeviceDefaults={executionDeviceDefaults}
            cloudProject={cloudProject}
            emptyState={
              col.id === 'backlog' && projectIsEmpty
                ? repoActionsBlocked
                  ? projectRepoReadiness.message
                  : 'No tasks yet. Create one to get started.'
                : filtersActive &&
                    !noMatches &&
                    tasksByStatus[col.id].length === 0
                  ? 'No tasks in this column for the current filters.'
                  : undefined
            }
          />
        ))}
      </div>
    </DragDropContext>
  );
}
