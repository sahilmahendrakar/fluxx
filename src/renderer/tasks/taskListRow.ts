import { modelSummaryForTask } from '../../agentModelUi';
import {
  applyBoardFilters,
  type ApplyBoardFiltersRepoContext,
  type BoardFilterState,
} from '../../boardFilter';
import {
  effectiveTaskRepoId,
  findRepoByIdOrPrimary,
  repoChipTooltipText,
  repoDisplayLabel,
} from '../../repoIdentity';
import { selectSessionForTaskWorkspace } from '../../sessionWorkspacePick';
import { getBlockedTasks, getBlockingTasks, isTaskBlocked } from '../../taskDependencies';
import {
  effectiveTaskSourceBranchShort,
  normalizeGitBranchShortName,
  taskCardShouldShowSourceBranchChip,
} from '../../taskBranches';
import { normalizeTaskLabels } from '../../taskLabels';
import { whenUnblockedAutostartBoardChipEffective } from '../../unblockAutostart';
import type { ProjectMember } from '../projects/members';
import { projectMemberDisplayLabel } from '../projects/members';
import { compareTasks } from './orderKey';
import type {
  Agent,
  CloudRepoBindingOverview,
  RepoConfig,
  Session,
  Task,
  TaskGithubPrState,
  TaskStatus,
} from '../../types';
import { COLUMNS } from '../../types';

/**
 * Flat, sortable row for the task list view. Built from {@link Task} plus board
 * context (members, repos, sessions). There is no due-date field on {@link Task}
 * today; add it to `Task` and this shape when the product supports it.
 */
export type TaskListRow = {
  id: string;
  title: string;
  status: TaskStatus;
  /** Kanban column rank (matches {@link COLUMNS} order). */
  statusRank: number;
  orderKey: string;
  createdAt: string;
  /** Cloud sync timestamp; empty string when absent (local tasks). */
  updatedAt: string;

  labels: string[];

  assigneeId: string | null;
  assigneeDisplayName: string | null;
  assigneePhotoUrl: string | null;

  agent: Agent | null;
  agentModelSummary: string | null;

  effectiveRepoId: string;
  repoChipLabel: string | null;
  repoChipTitle: string | null;

  sourceBranchShort: string;
  showSourceBranchChip: boolean;
  branchChipTitle: string | null;

  isBlocked: boolean;
  /** Incomplete blockers (same rules as {@link isTaskBlocked}). */
  blockedByCount: number;
  /** Tasks that list this task in `blockedByTaskIds`. */
  blocksCount: number;

  isDone: boolean;
  workspaceCleaned: boolean;

  hasWorktree: boolean;
  canOpenTaskWorkspaceTab: boolean;

  githubPrUrl: string | null;
  githubPrState: TaskGithubPrState | null;
  prMerged: boolean;
  prLinked: boolean;

  effectiveUnblockAutostart: boolean;
};

export type TaskListRowBuildContext = {
  /** Full project task list (dependency resolution). */
  allTasks: readonly Task[];
  /** Tasks to render (usually board-filtered). */
  tasks: readonly Task[];
  primaryRepoId: string;
  repoDefaultBranchShort: string;
  autoStartWhenUnblockedProject: boolean;
  projectRepos?: readonly RepoConfig[];
  showRepoBoardUi?: boolean;
  cloudRepoBindingOverview?: CloudRepoBindingOverview;
  membersByUid?: ReadonlyMap<string, ProjectMember>;
  sessions?: readonly Session[];
  taskHasWorktreeById?: Readonly<Record<string, boolean>>;
};

export type TaskListSortKey =
  | 'status'
  | 'title'
  | 'createdAt'
  | 'updatedAt'
  | 'assignee'
  | 'blockedByCount';

export type TaskListSort = {
  key: TaskListSortKey;
  direction: 'asc' | 'desc';
};

export const DEFAULT_TASK_LIST_SORT: TaskListSort = {
  key: 'status',
  direction: 'asc',
};

const STATUS_RANK: Record<TaskStatus, number> = Object.fromEntries(
  COLUMNS.map((c, i) => [c.id, i]),
) as Record<TaskStatus, number>;

function prFields(githubPr: Task['githubPr']): Pick<
  TaskListRow,
  'githubPrUrl' | 'githubPrState' | 'prMerged' | 'prLinked'
> {
  const url = githubPr?.url?.trim() ?? '';
  const state = githubPr?.state ?? null;
  const mergedAt = githubPr?.mergedAt?.trim() ?? '';
  const prMerged = state === 'merged' || mergedAt.length > 0;
  const prLinked = Boolean(url) && !prMerged;
  return {
    githubPrUrl: url || null,
    githubPrState: state,
    prMerged,
    prLinked,
  };
}

function assigneeFields(
  assigneeId: string | null,
  membersByUid: ReadonlyMap<string, ProjectMember> | undefined,
): Pick<TaskListRow, 'assigneeDisplayName' | 'assigneePhotoUrl'> {
  if (!assigneeId) {
    return { assigneeDisplayName: null, assigneePhotoUrl: null };
  }
  const member = membersByUid?.get(assigneeId);
  if (!member) {
    return { assigneeDisplayName: null, assigneePhotoUrl: null };
  }
  return {
    assigneeDisplayName: projectMemberDisplayLabel(member),
    assigneePhotoUrl: member.photoURL?.trim() || null,
  };
}

type RowBuildDeps = {
  allTasks: readonly Task[];
  primaryRepoId: string;
  repoDefaultBranchShort: string;
  autoStartWhenUnblockedProject: boolean;
  showRepoBoardUi: boolean;
  projectRepos: readonly RepoConfig[];
  cloudRepoBindingOverview?: CloudRepoBindingOverview;
  membersByUid?: ReadonlyMap<string, ProjectMember>;
  sessions: readonly Session[];
  taskHasWorktreeById: Readonly<Record<string, boolean>>;
};

export function buildTaskListRow(task: Task, deps: RowBuildDeps): TaskListRow {
  const {
    allTasks,
    primaryRepoId,
    repoDefaultBranchShort,
    autoStartWhenUnblockedProject,
    showRepoBoardUi,
    projectRepos,
    cloudRepoBindingOverview,
    membersByUid,
    sessions,
    taskHasWorktreeById,
  } = deps;

  const effectiveRepoId = effectiveTaskRepoId(task, primaryRepoId);
  const effectiveRepo =
    showRepoBoardUi && projectRepos.length > 0
      ? findRepoByIdOrPrimary(projectRepos, task.repoId)
      : undefined;
  const branchChipCompareShort =
    showRepoBoardUi && effectiveRepo
      ? normalizeGitBranchShortName(effectiveRepo.baseBranch || 'main')
      : repoDefaultBranchShort;

  const showSourceBranchChip = taskCardShouldShowSourceBranchChip(task, branchChipCompareShort);
  const sourceBranchShort = effectiveTaskSourceBranchShort(task, branchChipCompareShort);
  const branchChipTitle = showSourceBranchChip
    ? task.createSourceBranchIfMissing === true
      ? `${sourceBranchShort} — Flux will create this branch when the task starts`
      : `Source branch: ${sourceBranchShort}`
    : null;

  const repoChip =
    showRepoBoardUi && effectiveRepo
      ? {
          label: repoDisplayLabel(effectiveRepo),
          title: repoChipTooltipText(
            effectiveRepo,
            cloudRepoBindingOverview?.[effectiveRepo.id],
          ),
        }
      : null;

  const sessionWorktree = sessions.some(
    (s) => s.taskId === task.id && Boolean(s.worktreePath?.trim()),
  );
  const diskWorktree = taskHasWorktreeById[task.id] === true;
  const hasWorktree = sessionWorktree || diskWorktree;
  const canOpenTaskWorkspaceTab =
    selectSessionForTaskWorkspace(sessions, task.id) !== undefined;

  const assigneeId = task.assigneeId?.trim() || null;
  const blocking = getBlockingTasks(task, [...allTasks]);
  const isDone = task.status === 'done';

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    statusRank: STATUS_RANK[task.status],
    orderKey: task.orderKey ?? '',
    createdAt: task.createdAt ?? '',
    updatedAt: task.updatedAt ?? '',

    labels: normalizeTaskLabels(task.labels),

    assigneeId,
    ...assigneeFields(assigneeId, membersByUid),

    agent: task.agent,
    agentModelSummary: modelSummaryForTask(task) ?? null,

    effectiveRepoId,
    repoChipLabel: repoChip?.label ?? null,
    repoChipTitle: repoChip?.title ?? null,

    sourceBranchShort,
    showSourceBranchChip,
    branchChipTitle,

    isBlocked: isTaskBlocked(task, [...allTasks]),
    blockedByCount: blocking.length,
    blocksCount: getBlockedTasks(task.id, [...allTasks]).length,

    isDone,
    workspaceCleaned: Boolean(task.workspaceCleanedAt),

    hasWorktree,
    canOpenTaskWorkspaceTab,

    ...prFields(task.githubPr),

    effectiveUnblockAutostart: whenUnblockedAutostartBoardChipEffective(
      task,
      autoStartWhenUnblockedProject,
    ),
  };
}

/** Builds one {@link TaskListRow} per task in `ctx.tasks` (order not guaranteed). */
export function buildTaskListRows(ctx: TaskListRowBuildContext): TaskListRow[] {
  const deps: RowBuildDeps = {
    allTasks: ctx.allTasks,
    primaryRepoId: ctx.primaryRepoId,
    repoDefaultBranchShort: ctx.repoDefaultBranchShort,
    autoStartWhenUnblockedProject: ctx.autoStartWhenUnblockedProject,
    showRepoBoardUi: ctx.showRepoBoardUi === true,
    projectRepos: ctx.projectRepos ?? [],
    cloudRepoBindingOverview: ctx.cloudRepoBindingOverview,
    membersByUid: ctx.membersByUid,
    sessions: ctx.sessions ?? [],
    taskHasWorktreeById: ctx.taskHasWorktreeById ?? {},
  };
  return ctx.tasks.map((task) => buildTaskListRow(task, deps));
}

/**
 * Default list order: kanban column order, then board {@link compareTasks}
 * (orderKey → createdAt → id) within each status.
 */
export function compareTaskListRowsDefault(a: TaskListRow, b: TaskListRow): number {
  if (a.statusRank !== b.statusRank) return a.statusRank - b.statusRank;
  return compareTasks(
    {
      id: a.id,
      orderKey: a.orderKey || undefined,
      createdAt: a.createdAt,
    } as Task,
    {
      id: b.id,
      orderKey: b.orderKey || undefined,
      createdAt: b.createdAt,
    } as Task,
  );
}

function cmpString(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

/** Sort comparator for explicit list column sorts (tie-break with {@link compareTaskListRowsDefault}). */
export function compareTaskListRows(a: TaskListRow, b: TaskListRow, sort: TaskListSort): number {
  const dir = sort.direction === 'asc' ? 1 : -1;
  let primary = 0;
  switch (sort.key) {
    case 'status':
      primary = a.statusRank - b.statusRank;
      break;
    case 'title':
      primary = cmpString(a.title, b.title);
      break;
    case 'createdAt':
      primary = cmpString(a.createdAt, b.createdAt);
      break;
    case 'updatedAt':
      primary = cmpString(a.updatedAt, b.updatedAt);
      break;
    case 'assignee': {
      const an = a.assigneeDisplayName ?? '';
      const bn = b.assigneeDisplayName ?? '';
      if (!an && bn) primary = 1;
      else if (an && !bn) primary = -1;
      else primary = cmpString(an, bn);
      break;
    }
    case 'blockedByCount':
      primary = a.blockedByCount - b.blockedByCount;
      break;
    default:
      primary = 0;
  }
  if (primary !== 0) return primary * dir;
  return compareTaskListRowsDefault(a, b);
}

/** Build rows and apply sort (copies array; does not mutate `ctx.tasks`). */
export function queryTaskListRows(
  ctx: TaskListRowBuildContext,
  options?: { sort?: TaskListSort },
): TaskListRow[] {
  const rows = buildTaskListRows(ctx);
  const sort = options?.sort ?? DEFAULT_TASK_LIST_SORT;
  return [...rows].sort((a, b) => compareTaskListRows(a, b, sort));
}

/**
 * Board-filtered list query: same subset as the kanban board, then flat rows.
 */
export function queryTaskListRowsFromBoard(
  allTasks: readonly Task[],
  boardFilter: BoardFilterState,
  ctx: Omit<TaskListRowBuildContext, 'allTasks' | 'tasks'> & {
    repoFilterContext?: ApplyBoardFiltersRepoContext;
  },
  options?: { sort?: TaskListSort },
): TaskListRow[] {
  const visible = applyBoardFilters(allTasks, boardFilter, ctx.repoFilterContext);
  return queryTaskListRows(
    {
      ...ctx,
      allTasks,
      tasks: visible,
    },
    options,
  );
}
