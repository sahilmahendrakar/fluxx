import { Draggable } from '@hello-pangea/dnd';
import { broom } from '@lucide/lab';
import {
  Ban,
  CirclePlay,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestCreate,
  Icon,
  Layers2,
  Loader2,
} from 'lucide-react';
import { Task } from '../types';
import { getBlockedTasks, isTaskBlocked } from '../taskDependencies';
import { effectiveTaskSourceBranchShort, taskCardShouldShowSourceBranchChip } from '../taskBranches';
import { modelSummaryForTask } from '../agentModelUi';
import AgentBadge from './AgentBadge';
import type { ProjectMember } from '../renderer/projects/members';
import { ProjectMemberAvatar } from './ProjectMemberAvatar';

const STATUS_DOT: Record<Task['status'], string> = {
  'in-progress': 'bg-emerald-400/80',
  'needs-input': 'bg-amber-400/80',
  backlog: 'bg-zinc-600',
  done: 'bg-zinc-600',
};

interface Props {
  task: Task;
  allTasks: Task[];
  index: number;
  onDelete: (id: string) => void;
  onRequestCleanupTask?: (id: string) => void;
  cleanupLoading?: boolean;
  onCardClick: (id: string) => void;
  onLabelClick?: (label: string) => void;
  autoStartWhenUnblockedProject: boolean;
  onToggleTaskAutoStartOnUnblock: (taskId: string, enabled: boolean) => void;
  assigneeMember?: ProjectMember;
  onTaskPrClick?: (taskId: string) => void;
  prLoading?: boolean;
  repoDefaultBranchShort: string;
  /** Cloud: current user uid — when set and task has another assignee, per-task unblock toggle is read-only. */
  cloudUnblockAutostartClientUid?: string;
  /** When false, the GitHub PR control is hidden (no local/session worktree). */
  hasWorktree?: boolean;
}

export default function TaskCard({
  task,
  allTasks,
  index,
  onDelete,
  onRequestCleanupTask,
  cleanupLoading = false,
  onCardClick,
  onLabelClick,
  autoStartWhenUnblockedProject,
  onToggleTaskAutoStartOnUnblock,
  assigneeMember,
  onTaskPrClick,
  prLoading = false,
  repoDefaultBranchShort,
  cloudUnblockAutostartClientUid,
  hasWorktree = false,
}: Props) {
  const isNeedsInput = task.status === 'needs-input';
  const isDone = task.status === 'done';
  const workspaceCleaned = Boolean(task.workspaceCleanedAt);
  const agentBadgeTitle = modelSummaryForTask(task);
  const blocked = isTaskBlocked(task, allTasks);
  const blocksCount = getBlockedTasks(task.id, allTasks).length;
  const perTaskUnblockAuto = task.autoStartOnUnblock === true;
  const projectUnblockAuto = autoStartWhenUnblockedProject;
  const prUrl = task.githubPr?.url?.trim() ?? '';
  const prState = task.githubPr?.state;
  const prMergedAt = task.githubPr?.mergedAt?.trim() ?? '';
  const prMerged = prState === 'merged' || prMergedAt.length > 0;
  const prIsOpen = prState === 'open';
  const prIsClosed = prState === 'closed';
  const prLinked = Boolean(prUrl) && !prMerged;
  const showBranchChip = taskCardShouldShowSourceBranchChip(task, repoDefaultBranchShort);
  const branchChipLabel = effectiveTaskSourceBranchShort(task, repoDefaultBranchShort);
  const branchChipTitle =
    task.createSourceBranchIfMissing === true
      ? `${branchChipLabel} — Flux will create this branch when the task starts`
      : `Source branch: ${branchChipLabel}`;
  const unblockToggleLockedByOtherAssignee = Boolean(
    cloudUnblockAutostartClientUid &&
      task.assigneeId?.trim() &&
      task.assigneeId !== cloudUnblockAutostartClientUid,
  );

  const unblockChipTitle = unblockToggleLockedByOtherAssignee
    ? 'Only the assignee can change per-task auto-start when unblocked for this task'
    : perTaskUnblockAuto
      ? 'Per-task auto-start when unblocked is on — click to turn off'
      : projectUnblockAuto
        ? 'This project auto-starts when unblocked — click to add a per-task override (on)'
        : 'Click to auto-start a session when the last dependency completes (this task)';

  const unblockChipAriaLabel = unblockToggleLockedByOtherAssignee
    ? 'Blocked: only the assignee can change per-task auto-start when unblocked for this task'
    : perTaskUnblockAuto
      ? 'Blocked: per-task auto-start when unblocked is on; click to turn off'
      : projectUnblockAuto
        ? 'Blocked: this project auto-starts when unblocked; click to add a per-task override to turn auto-start on for this task'
        : 'Blocked: click to enable auto-start when unblocked for this task';

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`group rounded-md border border-white/[0.06] bg-[#141416] shadow-sm transition-colors ${
            isNeedsInput ? 'border-l-[3px] border-l-amber-400/65' : ''
          } ${isDone ? 'opacity-55' : ''} ${
            snapshot.isDragging
              ? 'border-white/[0.12] bg-[#18181b] shadow-lg ring-1 ring-white/[0.08]'
              : 'hover:border-white/[0.1] hover:bg-[#161618]'
          }`}
        >
          <div
            {...provided.dragHandleProps}
            className="cursor-grab rounded-md p-3 active:cursor-grabbing"
          >
            <div
              role="presentation"
              onClick={() => onCardClick(task.id)}
              className="cursor-grab"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[13px] font-medium leading-snug tracking-tight break-words ${
                      isDone ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-200'
                    }`}
                  >
                    {task.title}
                  </p>
                  {task.labels && task.labels.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {task.labels.map((lb) =>
                        onLabelClick ? (
                          <button
                            key={lb}
                            type="button"
                            title="Filter by this label"
                            aria-label={`Filter board by label ${lb}`}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onLabelClick(lb);
                            }}
                            className="max-w-full cursor-pointer truncate rounded-full border border-violet-400/20 bg-gradient-to-b from-violet-500/12 to-violet-600/8 px-2 py-0.5 text-left text-[10px] font-medium text-violet-200/90 ring-1 ring-inset ring-violet-500/10 transition hover:border-violet-400/35 hover:from-violet-500/18 hover:to-violet-600/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
                          >
                            {lb}
                          </button>
                        ) : (
                          <span
                            key={lb}
                            className="max-w-full truncate rounded-full border border-violet-400/20 bg-gradient-to-b from-violet-500/12 to-violet-600/8 px-2 py-0.5 text-[10px] font-medium text-violet-200/90 ring-1 ring-inset ring-violet-500/10"
                            title={lb}
                          >
                            {lb}
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(task.id);
                  }}
                  className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[13px] leading-none text-zinc-600 opacity-0 transition hover:bg-white/[0.06] hover:text-zinc-300 group-hover:opacity-100"
                  aria-label="Delete task"
                >
                  ×
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <AgentBadge agent={task.agent} title={agentBadgeTitle} />
                  {showBranchChip ? (
                    <span
                      title={branchChipTitle}
                      className="inline-flex max-w-[11rem] items-center gap-0.5 truncate rounded border border-sky-500/25 bg-sky-500/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-sky-200/90"
                    >
                      <GitBranch className="h-3 w-3 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                      <span className="truncate font-mono">{branchChipLabel}</span>
                      {task.createSourceBranchIfMissing === true ? (
                        <span className="shrink-0 text-[9px] font-sans uppercase tracking-wide text-sky-300/80">
                          new
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {blocked && !isDone ? (
                    <button
                      type="button"
                      disabled={unblockToggleLockedByOtherAssignee}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (unblockToggleLockedByOtherAssignee) return;
                        onToggleTaskAutoStartOnUnblock(task.id, !perTaskUnblockAuto);
                      }}
                      title={unblockChipTitle}
                      aria-label={unblockChipAriaLabel}
                      className={`-m-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border transition ${
                        unblockToggleLockedByOtherAssignee
                          ? 'cursor-not-allowed border-white/[0.06] bg-white/[0.03] text-zinc-500 opacity-80'
                          : perTaskUnblockAuto
                            ? 'border-emerald-500/35 bg-emerald-500/[0.1] text-emerald-200/90 hover:border-emerald-400/45'
                            : projectUnblockAuto
                              ? 'border-sky-500/30 bg-sky-500/[0.08] text-sky-200/90 hover:border-sky-400/40'
                              : 'border-amber-500/25 bg-amber-500/[0.08] text-amber-200/90 hover:border-amber-400/35'
                      }`}
                    >
                      {perTaskUnblockAuto ? (
                        <CirclePlay className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      ) : projectUnblockAuto ? (
                        <Layers2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      ) : (
                        <Ban className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      )}
                    </button>
                  ) : null}
                  {blocksCount > 0 ? (
                    <span
                      className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
                      title={`${blocksCount} task(s) depend on this one`}
                    >
                      Blocks {blocksCount}
                    </span>
                  ) : null}
                  {onTaskPrClick && hasWorktree ? (
                    <button
                      type="button"
                      disabled={prLoading}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTaskPrClick(task.id);
                      }}
                      className={`-m-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        prMerged
                          ? 'text-purple-400/85 hover:bg-purple-500/12 hover:text-purple-300/90'
                          : prIsOpen
                            ? 'text-emerald-500/75 hover:bg-emerald-500/10 hover:text-emerald-400/85'
                            : prLinked
                              ? 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'
                              : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300'
                      }`}
                      aria-label={
                        prLoading
                          ? 'Working with pull request…'
                          : prMerged
                            ? 'Open merged pull request'
                            : prIsOpen
                              ? 'Open pull request'
                              : prIsClosed
                                ? 'Open closed pull request'
                                : prLinked
                                  ? 'Open pull request'
                                  : 'Create GitHub pull request'
                      }
                      title={
                        prLoading
                          ? 'Please wait…'
                          : prMerged
                            ? 'Open merged pull request'
                            : prIsOpen
                              ? 'Open pull request'
                              : prIsClosed
                                ? 'Open closed pull request'
                                : prLinked
                                  ? 'Open pull request'
                                  : 'Create GitHub pull request'
                      }
                    >
                      {prLoading ? (
                        <Loader2
                          className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400"
                          aria-hidden
                        />
                      ) : prMerged ? (
                        <GitMerge className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      ) : prLinked ? (
                        <GitPullRequest className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      ) : (
                        <GitPullRequestCreate className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      )}
                    </button>
                  ) : null}
                  {isDone && onRequestCleanupTask ? (
                    workspaceCleaned ? (
                      <span
                        className="-m-0.5 flex h-6 w-6 cursor-default items-center justify-center rounded text-zinc-600/45 opacity-50"
                        title="task cleaned"
                        aria-label="Task workspace already cleaned"
                      >
                        <Icon
                          iconNode={broom}
                          size={14}
                          strokeWidth={1.75}
                          className="text-zinc-600/70"
                          aria-hidden
                        />
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={cleanupLoading}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestCleanupTask(task.id);
                        }}
                        className="-m-0.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-100"
                        aria-label={
                          cleanupLoading
                            ? 'Cleaning up workspace…'
                            : 'Clean up workspace for this task'
                        }
                        title={cleanupLoading ? 'Cleaning up…' : 'Clean up workspace'}
                      >
                        {cleanupLoading ? (
                          <Loader2
                            className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400"
                            aria-hidden
                          />
                        ) : (
                          <Icon
                            iconNode={broom}
                            size={14}
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        )}
                      </button>
                    )
                  ) : null}
                  {assigneeMember ? (
                    <ProjectMemberAvatar member={assigneeMember} size="sm" />
                  ) : null}
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[task.status]}`}
                    aria-hidden
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}
