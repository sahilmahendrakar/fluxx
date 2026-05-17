import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Draggable } from '@hello-pangea/dnd';
import { broom } from '@lucide/lab';
import {
  Ban,
  CirclePlay,
  FolderGit2,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestCreate,
  Icon,
  Loader2,
  Terminal,
  UserCircle2,
} from 'lucide-react';
import { Task } from '../types';
import { getBlockedTasks, isTaskBlocked } from '../taskDependencies';
import { effectiveTaskSourceBranchShort, taskCardShouldShowSourceBranchChip } from '../taskBranches';
import { TaskCardAgentSpawnMenu, type TaskAgentSpawnPatch } from './TaskCardAgentSpawnMenu';
import type { TaskPatch } from '../renderer/tasks/TaskProvider';
import {
  patchAutoStartOnUnblockAfterToggle,
  whenUnblockedAutostartBoardChipEffective,
} from '../unblockAutostart';
import { type ProjectMember, projectMemberDisplayLabel } from '../renderer/projects/members';
import { ProjectMemberAvatar } from './ProjectMemberAvatar';

const ASSIGNEE_MENU_MAX_H_PX = 224;

function TaskCardAssigneeFooter({
  taskId,
  assigneeId,
  assigneeMember,
  cloudProjectMembers,
  onAssigneeChange,
}: {
  taskId: string;
  assigneeId: string | null | undefined;
  assigneeMember?: ProjectMember;
  /** Set for cloud projects (may be empty while members load). */
  cloudProjectMembers?: ProjectMember[];
  onAssigneeChange?: (taskId: string, assigneeId: string | null) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 220 });

  const hasAssigneeUid = Boolean(assigneeId?.trim());
  const isCloudAssigneeBoard =
    cloudProjectMembers !== undefined && typeof onAssigneeChange === 'function';

  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const width = Math.max(220, r.width);
    let left = r.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = r.bottom + 4;
    if (top + ASSIGNEE_MENU_MAX_H_PX > window.innerHeight - 8) {
      top = r.top - 4 - ASSIGNEE_MENU_MAX_H_PX;
    }
    if (top < 8) top = 8;
    setMenuPos({ top, left, width });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onScroll = () => setMenuOpen(false);
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen || !menuRef.current) return;
    const first = menuRef.current.querySelector<HTMLButtonElement>('button[role="option"]');
    requestAnimationFrame(() => first?.focus());
  }, [menuOpen]);

  const listboxId = `task-card-${taskId}-assignee-listbox`;
  const triggerId = `task-card-${taskId}-assignee-trigger`;

  if (!isCloudAssigneeBoard) {
    return null;
  }

  if (assigneeMember) {
    return <ProjectMemberAvatar member={assigneeMember} size="sm" />;
  }

  if (hasAssigneeUid) {
    return (
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-500/[0.15] text-[10px] font-medium text-zinc-400 ring-1 ring-white/10"
        title="Unknown member"
        aria-label="Assignee is an unknown member"
      >
        ?
      </span>
    );
  }

  const assignMember = onAssigneeChange;
  const menu = menuOpen
    ? createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={triggerId}
          className="fixed z-[300] max-h-56 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#111113] py-1 shadow-xl shadow-black/50"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            maxHeight: ASSIGNEE_MENU_MAX_H_PX,
          }}
        >
          {cloudProjectMembers.length === 0 ? (
            <p className="px-2.5 py-2 text-left text-[12px] text-zinc-500">No team members yet.</p>
          ) : (
            cloudProjectMembers.map((m) => {
              const selected = assigneeId === m.uid;
              return (
                <button
                  key={m.uid}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none ${
                    selected ? 'bg-white/[0.04] text-zinc-50' : 'text-zinc-200'
                  }`}
                  onClick={() => {
                    assignMember(taskId, m.uid);
                    setMenuOpen(false);
                  }}
                >
                  <ProjectMemberAvatar member={m} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{projectMemberDisplayLabel(m)}</span>
                </button>
              );
            })
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div ref={wrapRef} className="relative shrink-0">
        <button
          ref={triggerRef}
          type="button"
          id={triggerId}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          aria-controls={listboxId}
          aria-label={
            menuOpen
              ? 'Member menu open — choose who to assign'
              : 'Task unassigned — open menu to assign a project member'
          }
          title="Assign to a project member"
          className="-m-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-zinc-800/90 text-zinc-500 ring-1 ring-white/10 transition hover:bg-zinc-700/90 hover:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/45"
        >
          <UserCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      {menu}
    </>
  );
}

const STATUS_DOT: Record<Task['status'], string> = {
  'in-progress': 'bg-emerald-400/80',
  'needs-input': 'bg-amber-400/80',
  review: 'bg-sky-400/85',
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
  onPatchTaskAutoStartOnUnblock: (taskId: string, patch: Pick<TaskPatch, 'autoStartOnUnblock'>) => void;
  assigneeMember?: ProjectMember;
  /** Cloud: roster for quick assign from the card. Omit on local projects (no assignee slot on cards). */
  cloudProjectMembers?: ProjectMember[];
  onTaskAssigneeChange?: (taskId: string, assigneeId: string | null) => void;
  onTaskPrClick?: (taskId: string) => void;
  prLoading?: boolean;
  prAgentAwaiting?: boolean;
  repoDefaultBranchShort: string;
  /** When set, branch chip compares against this repo's default (multi-repo), not the board-wide default. */
  branchChipCompareShort?: string;
  /** Multi-repo: compact repo label + tooltip (omit when single-repo or flag off). */
  repoChip?: { label: string; title: string };
  /** Cloud: current user uid — when set and task has another assignee, per-task unblock toggle is read-only. */
  cloudUnblockAutostartClientUid?: string;
  /** When false, the GitHub PR control is hidden (no local/session worktree). */
  hasWorktree?: boolean;
  /** Persist agent / model / YOLO for this task (same fields as task detail & `flux tasks update`). */
  onTaskAgentSpawnPrefsChange: (taskId: string, patch: TaskAgentSpawnPatch) => void;
  /** True when a daemon session exists for this task (main-window session tab can be opened). */
  canOpenTaskWorkspaceTab: boolean;
  /** Opens the task’s daemon session in a main-window tab (same as task detail “Open in tab”). */
  onOpenTaskWorkspaceTab: (taskId: string) => void;
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
  onPatchTaskAutoStartOnUnblock,
  assigneeMember,
  cloudProjectMembers,
  onTaskAssigneeChange,
  onTaskPrClick,
  prLoading = false,
  prAgentAwaiting = false,
  repoDefaultBranchShort,
  branchChipCompareShort,
  repoChip,
  cloudUnblockAutostartClientUid,
  hasWorktree = false,
  onTaskAgentSpawnPrefsChange,
  canOpenTaskWorkspaceTab,
  onOpenTaskWorkspaceTab,
}: Props) {
  const isNeedsInput = task.status === 'needs-input';
  const isReview = task.status === 'review';
  const isDone = task.status === 'done';
  const workspaceCleaned = Boolean(task.workspaceCleanedAt);
  const blocked = isTaskBlocked(task, allTasks);
  const blocksCount = getBlockedTasks(task.id, allTasks).length;
  const projectUnblockAuto = autoStartWhenUnblockedProject;
  const effectiveUnblockAutostart = whenUnblockedAutostartBoardChipEffective(task, projectUnblockAuto);
  const prUrl = task.githubPr?.url?.trim() ?? '';
  const prState = task.githubPr?.state;
  const prMergedAt = task.githubPr?.mergedAt?.trim() ?? '';
  const prMerged = prState === 'merged' || prMergedAt.length > 0;
  const prIsOpen = prState === 'open';
  const prIsClosed = prState === 'closed';
  const prLinked = Boolean(prUrl) && !prMerged;
  const prAwaitingAgent = Boolean(prAgentAwaiting) && !prUrl && !prLoading;
  const branchCompareShort = branchChipCompareShort ?? repoDefaultBranchShort;
  const showBranchChip = taskCardShouldShowSourceBranchChip(task, branchCompareShort);
  const branchChipLabel = effectiveTaskSourceBranchShort(task, branchCompareShort);
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
    : effectiveUnblockAutostart
      ? 'Will auto-start a session when the last dependency completes — click to turn off'
      : 'Will not auto-start when the last dependency completes — click to turn on';

  const unblockChipAriaLabel = unblockToggleLockedByOtherAssignee
    ? 'Blocked: only the assignee can change per-task auto-start when unblocked for this task'
    : effectiveUnblockAutostart
      ? 'Blocked: will auto-start when unblocked; click to turn off'
      : 'Blocked: will not auto-start when unblocked; click to turn on';

  const tryOpenTaskDetail = () => {
    onCardClick(task.id);
  };

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`group rounded-md border border-white/[0.06] bg-[#141416] shadow-sm transition-colors ${
            isNeedsInput ? 'border-l-[3px] border-l-amber-400/65' : ''
          } ${isReview ? 'border-l-[3px] border-l-sky-400/60' : ''} ${isDone ? 'opacity-55' : ''} ${
            snapshot.isDragging
              ? 'border-white/[0.12] bg-[#18181b] shadow-lg ring-1 ring-white/[0.08]'
              : 'hover:border-white/[0.1] hover:bg-[#161618]'
          }`}
        >
          <div
            {...provided.dragHandleProps}
            className="cursor-grab rounded-md p-3 active:cursor-grabbing"
          >
            <div role="presentation" className="cursor-grab">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 cursor-pointer" onClick={tryOpenTaskDetail}>
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
              <div
                className="mt-3 flex items-center justify-between gap-2"
                onClick={(e) => {
                  const t = e.target as HTMLElement;
                  if (t.closest('button')) return;
                  tryOpenTaskDetail();
                }}
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <TaskCardAgentSpawnMenu
                    task={task}
                    onPatch={(patch) => onTaskAgentSpawnPrefsChange(task.id, patch)}
                  />
                  <button
                    type="button"
                    disabled={!canOpenTaskWorkspaceTab}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canOpenTaskWorkspaceTab) return;
                      onOpenTaskWorkspaceTab(task.id);
                    }}
                    className={`-m-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/45 ${
                      canOpenTaskWorkspaceTab
                        ? 'cursor-pointer text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300'
                        : 'cursor-not-allowed border border-transparent text-zinc-600/50 opacity-70'
                    }`}
                    aria-label={
                      canOpenTaskWorkspaceTab
                        ? 'Open task workspace in tab'
                        : 'Open task workspace in tab — unavailable until you start a session from task details'
                    }
                    title={
                      canOpenTaskWorkspaceTab
                        ? 'Open task workspace in tab'
                        : 'No session yet — open task details and start a session'
                    }
                  >
                    <Terminal className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                  </button>
                  {repoChip ? (
                    <span
                      role="img"
                      title={repoChip.title}
                      aria-label={repoChip.title}
                      className="inline-flex max-w-[10rem] shrink-0 items-center gap-0.5 truncate rounded border border-emerald-500/25 bg-emerald-500/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-emerald-200/90"
                    >
                      <FolderGit2 className="h-3 w-3 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                      <span className="truncate" aria-hidden>
                        {repoChip.label}
                      </span>
                    </span>
                  ) : null}
                  {showBranchChip ? (
                    <span
                      role="img"
                      title={branchChipTitle}
                      aria-label={branchChipTitle}
                      className="inline-flex max-w-[11rem] items-center gap-0.5 truncate rounded border border-sky-500/25 bg-sky-500/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-sky-200/90"
                    >
                      <GitBranch className="h-3 w-3 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                      <span className="truncate font-mono" aria-hidden>
                        {branchChipLabel}
                      </span>
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
                        onPatchTaskAutoStartOnUnblock(
                          task.id,
                          patchAutoStartOnUnblockAfterToggle(task, projectUnblockAuto),
                        );
                      }}
                      title={unblockChipTitle}
                      aria-label={unblockChipAriaLabel}
                      className={`-m-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border transition ${
                        unblockToggleLockedByOtherAssignee
                          ? 'cursor-not-allowed border-white/[0.06] bg-white/[0.03] text-zinc-500 opacity-80'
                          : effectiveUnblockAutostart
                            ? 'border-emerald-500/35 bg-emerald-500/[0.1] text-emerald-200/90 hover:border-emerald-400/45'
                            : 'border-amber-500/25 bg-amber-500/[0.08] text-amber-200/90 hover:border-amber-400/35'
                      }`}
                    >
                      {effectiveUnblockAutostart ? (
                        <CirclePlay className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
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
                              : prAwaitingAgent
                                ? 'text-amber-400/80 hover:bg-amber-500/10 hover:text-amber-300/85'
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
                                  : prAwaitingAgent
                                    ? 'Pull request requested from agent; click to send creation prompt again'
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
                                  : prAwaitingAgent
                                    ? 'PR creation was sent to the agent — click to send again, or wait for automatic checks'
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
                  <TaskCardAssigneeFooter
                    taskId={task.id}
                    assigneeId={task.assigneeId}
                    assigneeMember={assigneeMember}
                    cloudProjectMembers={cloudProjectMembers}
                    onAssigneeChange={onTaskAssigneeChange}
                  />
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
