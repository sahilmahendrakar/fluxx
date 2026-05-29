import { useCallback, useMemo, useState } from 'react';
import { Columns3, LayoutList } from 'lucide-react';
import { DropResult } from '@hello-pangea/dnd';
import {
  Session,
  Task,
  Agent,
  type CloudRepoBindingOverview,
  type ExecutionDeviceConfig,
  type RepoConfig,
  type TaskExecutionDeviceRef,
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
import Board from './Board';
import NewTaskModal from './NewTaskModal';
import { BoardFilterBar } from './BoardFilterBar';
import { BoardRepoOnboardingBanner } from './BoardRepoOnboardingBanner';
import { BoardPlanningInitCallout } from './BoardPlanningInitCallout';
import {
  projectRepoActionsBlocked,
  type ProjectRepoReadiness,
} from '../projectRepoReadiness';
import type { TaskAgentSpawnPatch } from './TaskCardAgentSpawnMenu';
import type { TaskPatch } from '../renderer/tasks/TaskProvider';
import type { ExecutionDeviceDefaults } from '../hooks/useExecutionDeviceDefaults';

interface Props {
  allTasks: Task[];
  taskViewMode: 'board' | 'list';
  onTaskViewModeChange: (mode: 'board' | 'list') => void;
  onDragEnd: (result: DropResult) => void;
  onCreateTask: (
    title: string,
    agent: Agent | null,
    labels?: string[],
    assigneeId?: string,
    branch?: {
      sourceBranch?: string;
      createSourceBranchIfMissing?: boolean;
      repoId?: string;
    },
    executionDevice?: TaskExecutionDeviceRef,
  ) => void;
  defaultTaskAgent: Agent;
  onDeleteTask: (id: string, opts?: { closeDetail?: boolean }) => void;
  onRequestCleanupTask: (id: string) => void;
  cleanupLoadingTaskId: string | null;
  onCardClick: (id: string) => void;
  autoStartWhenUnblockedProject: boolean;
  validationEnabledProject: boolean;
  onPatchTaskAutoStartOnUnblock: (taskId: string, patch: Pick<TaskPatch, 'autoStartOnUnblock'>) => void;
  planPanelOpen: boolean;
  onTogglePlanPanel: () => void;
  projectMembers?: ProjectMember[];
  onTaskAssigneeChange?: (taskId: string, assigneeId: string | null) => void;
  onTaskPrClick?: (taskId: string) => void;
  prLoadingTaskId?: string | null;
  prAgentAwaitingByTaskId?: Record<string, boolean>;
  repoDefaultBranchShort: string;
  projectRepos?: RepoConfig[];
  multiRepo2Enabled?: boolean;
  cloudRepoBindingOverview?: CloudRepoBindingOverview;
  cloudUnblockAutostartClientUid?: string;
  sessions: Session[];
  taskHasWorktreeById: Record<string, boolean>;
  onTaskAgentSpawnPrefsChange: (taskId: string, patch: TaskAgentSpawnPatch) => void;
  onTaskExecutionDeviceChange: (taskId: string, ref: TaskExecutionDeviceRef) => void;
  onOpenTaskWorkspaceTab: (taskId: string) => void;
  projectRepoReadiness: ProjectRepoReadiness;
  onOpenProjectSettings: () => void;
  showPlanningInitCallout?: boolean;
  planningInitBusy?: boolean;
  onPlanningInitStart?: () => void;
  onPlanningInitSkip?: () => void;
  executionDevices?: ExecutionDeviceConfig[];
  executionDeviceDefaults?: ExecutionDeviceDefaults;
  cloudProject?: boolean;
}

export default function TaskWorkspace({
  allTasks,
  taskViewMode,
  onTaskViewModeChange,
  onDragEnd,
  onCreateTask,
  defaultTaskAgent,
  onDeleteTask,
  onRequestCleanupTask,
  cleanupLoadingTaskId,
  onCardClick,
  autoStartWhenUnblockedProject,
  validationEnabledProject,
  onPatchTaskAutoStartOnUnblock,
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
  onTaskExecutionDeviceChange,
  onOpenTaskWorkspaceTab,
  projectRepoReadiness,
  onOpenProjectSettings,
  showPlanningInitCallout = false,
  planningInitBusy = false,
  onPlanningInitStart,
  onPlanningInitSkip,
  executionDevices,
  executionDeviceDefaults,
  cloudProject = false,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [boardFilter, setBoardFilter] = useState<BoardFilterState>(
    () => ({ ...DEFAULT_BOARD_FILTER }),
  );

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

  const projectIsEmpty = allTasks.length === 0;
  const noMatches = !projectIsEmpty && visibleTasks.length === 0;
  const filtersActive = boardFiltersAreActive(boardFilter);
  const repoActionsBlocked = projectRepoActionsBlocked(projectRepoReadiness);

  const onRequestNewTask = useCallback(() => {
    setModalOpen(true);
  }, []);

  const onClearFilters = useCallback(() => {
    setBoardFilter({ ...DEFAULT_BOARD_FILTER });
  }, []);

  return (
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
          <div
            className="flex rounded-md border border-gray-700 p-0.5"
            role="group"
            aria-label="Task view"
          >
            <button
              type="button"
              onClick={() => onTaskViewModeChange('board')}
              aria-pressed={taskViewMode === 'board'}
              title="Board"
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                taskViewMode === 'board'
                  ? 'bg-gray-800 text-gray-200'
                  : 'text-gray-500 hover:bg-gray-800/50 hover:text-gray-300'
              }`}
            >
              <Columns3 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              Board
            </button>
            <button
              type="button"
              onClick={() => onTaskViewModeChange('list')}
              aria-pressed={taskViewMode === 'list'}
              title="List"
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                taskViewMode === 'list'
                  ? 'bg-gray-800 text-gray-200'
                  : 'text-gray-500 hover:bg-gray-800/50 hover:text-gray-300'
              }`}
            >
              <LayoutList className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              List
            </button>
          </div>
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
            onClick={onRequestNewTask}
            disabled={repoActionsBlocked}
            title={repoActionsBlocked ? projectRepoReadiness.message : undefined}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-600 hover:text-gray-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-700 disabled:hover:text-gray-500"
          >
            + New task
          </button>
        </div>
      </div>
      <BoardRepoOnboardingBanner
        readiness={projectRepoReadiness}
        onOpenProjectSettings={onOpenProjectSettings}
      />
      {showPlanningInitCallout && onPlanningInitStart && onPlanningInitSkip ? (
        <BoardPlanningInitCallout
          busy={planningInitBusy}
          onStart={onPlanningInitStart}
          onSkip={onPlanningInitSkip}
        />
      ) : null}
      {noMatches ? (
        <div
          className="shrink-0 border-b border-amber-500/15 bg-amber-500/[0.07] px-4 py-2 text-center text-[12px] text-amber-200/90"
          role="status"
        >
          No tasks match these filters.{' '}
          <button
            type="button"
            onClick={onClearFilters}
            className="font-medium text-amber-100/95 underline decoration-amber-400/40 underline-offset-2 hover:decoration-amber-200/60"
          >
            Clear filters
          </button>
          {' '}
          to see the full {taskViewMode === 'list' ? 'list' : 'board'}.
        </div>
      ) : null}
      {taskViewMode === 'board' ? (
        <Board
          allTasks={allTasks}
          visibleTasks={visibleTasks}
          onDragEnd={onDragEnd}
          onDeleteTask={onDeleteTask}
          onRequestCleanupTask={onRequestCleanupTask}
          cleanupLoadingTaskId={cleanupLoadingTaskId}
          onCardClick={onCardClick}
          onLabelClick={onLabelClick}
          onRequestNewTask={onRequestNewTask}
          autoStartWhenUnblockedProject={autoStartWhenUnblockedProject}
          validationEnabledProject={validationEnabledProject}
          onPatchTaskAutoStartOnUnblock={onPatchTaskAutoStartOnUnblock}
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
          projectIsEmpty={projectIsEmpty}
          noMatches={noMatches}
          filtersActive={filtersActive}
          repoActionsBlocked={repoActionsBlocked}
          projectRepoReadiness={projectRepoReadiness}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-gray-500">
          List view coming soon.
        </div>
      )}
      {modalOpen ? (
        <NewTaskModal
          labelCatalog={labelCatalog}
          defaultAgent={defaultTaskAgent}
          projectMembers={projectMembers}
          projectRepos={projectRepos}
          multiRepo2Enabled={multiRepo2Enabled}
          projectRepoReadiness={projectRepoReadiness}
          executionDevices={executionDevices ?? []}
          cloudProject={cloudProject}
          onOpenProjectSettings={onOpenProjectSettings}
          onClose={() => setModalOpen(false)}
          onCreate={(title, agent, labels, assigneeId, branch, executionDevice) => {
            onCreateTask(title, agent, labels, assigneeId, branch, executionDevice);
            setModalOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
