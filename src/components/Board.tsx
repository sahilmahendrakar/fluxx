import { useCallback, useMemo, useState } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import {
  Session,
  Task,
  TaskStatus,
  COLUMNS,
  Agent,
  type CloudRepoBindingOverview,
  type RepoConfig,
} from '../types';
import { projectLabelCatalog } from '../taskLabels';
import { resolvePrimaryRepoId } from '../repoIdentity';
import type { ProjectMember } from '../renderer/projects/members';
import {
  applyBoardFilters,
  boardFiltersAreActive,
  DEFAULT_BOARD_FILTER,
  type BoardFilterState,
  UNLABELED_VALUE,
} from '../boardFilter';
import Column from './Column';
import NewTaskModal from './NewTaskModal';
import { BoardFilterBar } from './BoardFilterBar';
import type { TaskAgentSpawnPatch } from './TaskCardAgentSpawnMenu';

interface Props {
  allTasks: Task[];
  onDragEnd: (result: DropResult) => void;
  onCreateTask: (
    title: string,
    agent: Agent,
    labels?: string[],
    assigneeId?: string,
    branch?: {
      sourceBranch?: string;
      createSourceBranchIfMissing?: boolean;
      repoId?: string;
    },
  ) => void;
  /** Initial agent selection in the new-task modal. */
  defaultTaskAgent: Agent;
  onDeleteTask: (id: string, opts?: { closeDetail?: boolean }) => void;
  onRequestCleanupTask: (id: string) => void;
  cleanupLoadingTaskId: string | null;
  onCardClick: (id: string) => void;
  autoStartWhenUnblockedProject: boolean;
  onToggleTaskAutoStartOnUnblock: (taskId: string, enabled: boolean) => void;
  planPanelOpen: boolean;
  onTogglePlanPanel: () => void;
  /** Cloud-only: team members for the assignee picker. */
  projectMembers?: ProjectMember[];
  /** Cloud boards: persist `assigneeId` from the card footer quick-assign control. */
  onTaskAssigneeChange?: (taskId: string, assigneeId: string | null) => void;
  onTaskPrClick?: (taskId: string) => void;
  prLoadingTaskId?: string | null;
  /** Task ids waiting for agent-created PR discovery (clock icon on cards). */
  prAgentAwaitingByTaskId?: Record<string, boolean>;
  /** Configured / detected default short branch name for branch chips on cards. */
  repoDefaultBranchShort: string;
  /** From main (`project:getRepos`) when multi-repo2 is enabled; drives new-task repo picker. */
  projectRepos?: RepoConfig[];
  multiRepo2Enabled?: boolean;
  /** Cloud: optional per-repo clone path/status for repo chip tooltips on cards. */
  cloudRepoBindingOverview?: CloudRepoBindingOverview;
  /** Cloud + signed-in: used to lock per-task unblock autostart when another member is assignee. */
  cloudUnblockAutostartClientUid?: string;
  /** Active daemon sessions (used with disk resolution to know if a task worktree exists). */
  sessions: Session[];
  /** Main-process `resolveTaskWorktreePath` result per task id (debounced in App). */
  taskHasWorktreeById: Record<string, boolean>;
  onTaskAgentSpawnPrefsChange: (taskId: string, patch: TaskAgentSpawnPatch) => void;
}

export default function Board({
  allTasks,
  onDragEnd,
  onCreateTask,
  defaultTaskAgent,
  onDeleteTask,
  onRequestCleanupTask,
  cleanupLoadingTaskId,
  onCardClick,
  autoStartWhenUnblockedProject,
  onToggleTaskAutoStartOnUnblock,
  planPanelOpen,
  onTogglePlanPanel,
  projectMembers,
  onTaskAssigneeChange,
  onTaskPrClick,
  prLoadingTaskId,
  prAgentAwaitingByTaskId,
  repoDefaultBranchShort,
  projectRepos,
  multiRepo2Enabled = false,
  cloudRepoBindingOverview,
  cloudUnblockAutostartClientUid,
  sessions,
  taskHasWorktreeById,
  onTaskAgentSpawnPrefsChange,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [boardFilter, setBoardFilter] = useState<BoardFilterState>(
    () => ({ ...DEFAULT_BOARD_FILTER }),
  );

  const membersMap = useMemo(() => {
    if (!projectMembers) return undefined;
    return new Map<string, ProjectMember>(
      projectMembers.map((member) => [member.uid, member]),
    );
  }, [projectMembers]);

  const labelCatalog = useMemo(
    () => projectLabelCatalog(allTasks),
    [allTasks],
  );

  const labelOptionsForSelect = useMemo(() => {
    const sel = boardFilter.label;
    if (sel == null || sel === UNLABELED_VALUE) {
      return labelCatalog;
    }
    if (labelCatalog.includes(sel)) {
      return labelCatalog;
    }
    return [...labelCatalog, sel].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }, [boardFilter.label, labelCatalog]);

  const showRepoBoardUi =
    multiRepo2Enabled && projectRepos != null && projectRepos.length > 1;

  const primaryRepoId = useMemo(
    () => resolvePrimaryRepoId(projectRepos ?? []),
    [projectRepos],
  );

  const repoFilterContext = useMemo(
    () => (primaryRepoId != null ? { primaryRepoId } : undefined),
    [primaryRepoId],
  );

  const visibleTasks = useMemo(
    () => applyBoardFilters(allTasks, boardFilter, repoFilterContext),
    [allTasks, boardFilter, repoFilterContext],
  );

  const onLabelClick = useCallback((label: string) => {
    setBoardFilter((prev) => ({ ...prev, label }));
  }, []);

  const doneHiddenCount = useMemo(() => {
    if (!boardFilter.hideDone) return 0;
    return allTasks.filter((t) => t.status === 'done').length;
  }, [allTasks, boardFilter.hideDone]);

  const tasksByStatus = useMemo(() => {
    const by = {} as Record<TaskStatus, Task[]>;
    for (const c of COLUMNS) {
      by[c.id] = [];
    }
    for (const task of visibleTasks) {
      by[task.status].push(task);
    }
    return by;
  }, [visibleTasks]);

  const projectIsEmpty = allTasks.length === 0;
  const noMatches = !projectIsEmpty && visibleTasks.length === 0;
  const filtersActive = boardFiltersAreActive(boardFilter);

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex shrink-0 flex-col gap-2 border-b border-gray-800 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
          <BoardFilterBar
            filter={boardFilter}
            onFilterChange={setBoardFilter}
            labelOptions={labelOptionsForSelect}
            doneHiddenCount={doneHiddenCount}
            projectMembers={projectMembers}
            showRepoFilter={showRepoBoardUi}
            projectRepos={projectRepos}
          />
          <div className="flex shrink-0 items-center justify-end gap-2 self-end sm:self-center">
            <button
              type="button"
              onClick={onTogglePlanPanel}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                planPanelOpen
                  ? 'border-gray-700 bg-gray-800 text-gray-200'
                  : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'
              }`}
            >
              Plan
            </button>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-600 hover:text-gray-300"
            >
              + New task
            </button>
          </div>
        </div>
        {noMatches ? (
          <div
            className="shrink-0 border-b border-amber-500/15 bg-amber-500/[0.07] px-4 py-2 text-center text-[12px] text-amber-200/90"
            role="status"
          >
            No tasks match these filters.{' '}
            <button
              type="button"
              onClick={() => setBoardFilter({ ...DEFAULT_BOARD_FILTER })}
              className="font-medium text-amber-100/95 underline decoration-amber-400/40 underline-offset-2 hover:decoration-amber-200/60"
            >
              Clear filters
            </button>
            {' '}
            to see the full board.
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden p-4">
          {COLUMNS.map((col) => (
            <Column
              key={col.id}
              id={col.id}
              label={col.label}
              tasks={tasksByStatus[col.id]}
              allTasks={allTasks}
              onNewTask={col.id === 'backlog' ? () => setModalOpen(true) : undefined}
              onDeleteTask={onDeleteTask}
              onRequestCleanupTask={col.id === 'done' ? onRequestCleanupTask : undefined}
              cleanupLoadingTaskId={col.id === 'done' ? cleanupLoadingTaskId : null}
              onCardClick={onCardClick}
              onLabelClick={onLabelClick}
              autoStartWhenUnblockedProject={autoStartWhenUnblockedProject}
              onToggleTaskAutoStartOnUnblock={onToggleTaskAutoStartOnUnblock}
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
              emptyState={
                col.id === 'backlog' && projectIsEmpty
                  ? 'No tasks yet. Create one to get started.'
                  : filtersActive &&
                      !noMatches &&
                      tasksByStatus[col.id].length === 0
                    ? 'No tasks in this column for the current filters.'
                    : undefined
              }
            />
          ))}
        </div>
      </div>
      {modalOpen ? (
        <NewTaskModal
          labelCatalog={labelCatalog}
          defaultAgent={defaultTaskAgent}
          projectMembers={projectMembers}
          projectRepos={projectRepos}
          multiRepo2Enabled={multiRepo2Enabled}
          onClose={() => setModalOpen(false)}
          onCreate={(title, agent, labels, assigneeId, branch) => {
            onCreateTask(title, agent, labels, assigneeId, branch);
            setModalOpen(false);
          }}
        />
      ) : null}
    </DragDropContext>
  );
}
