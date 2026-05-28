import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import {
  ExecutionDeviceConfig,
  SessionStatus,
  Task,
  type TaskExecutionDeviceRef,
} from '../types';
import { resolveTaskChipExecutionDevice } from '../executionDevices/resolveTaskChipDevice';
import { TaskCardExecutionDeviceMenu } from './TaskCardExecutionDeviceMenu';
import type { ExecutionDeviceDefaults } from '../hooks/useExecutionDeviceDefaults';
import { isTaskBlocked } from '../taskDependencies';
import { effectiveTaskSourceBranchShort, taskCardShouldShowSourceBranchChip } from '../taskBranches';
import { TaskCardAgentSpawnMenu, type TaskAgentSpawnPatch } from './TaskCardAgentSpawnMenu';
import type { TaskPatch } from '../renderer/tasks/TaskProvider';
import {
  patchAutoStartOnUnblockAfterToggle,
  whenUnblockedAutostartBoardChipEffective,
} from '../unblockAutostart';
import { type ProjectMember, projectMemberDisplayLabel } from '../renderer/projects/members';
import { ProjectMemberAvatar } from './ProjectMemberAvatar';
import { TASK_STATUS_DOT as STATUS_DOT } from '../taskStatusDot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import TaskCardValidationBadge from './validation/TaskCardValidationBadge';

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
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-1 ring-border"
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
          className="fixed z-[300] max-h-56 overflow-y-auto rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-xl"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            maxHeight: ASSIGNEE_MENU_MAX_H_PX,
          }}
        >
          {cloudProjectMembers.length === 0 ? (
            <p className="px-2.5 py-2 text-left text-[12px] text-muted-foreground">No team members yet.</p>
          ) : (
            cloudProjectMembers.map((m) => {
              const selected = assigneeId === m.uid;
              return (
                <Button
                  key={m.uid}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  variant="ghost"
                  className={cn(
                    'h-auto w-full justify-start gap-2 rounded-none px-2.5 py-2 text-left text-[12px]',
                    selected && 'bg-accent text-accent-foreground',
                  )}
                  onClick={() => {
                    assignMember(taskId, m.uid);
                    setMenuOpen(false);
                  }}
                >
                  <ProjectMemberAvatar member={m} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{projectMemberDisplayLabel(m)}</span>
                </Button>
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
        <Button
          ref={triggerRef}
          type="button"
          id={triggerId}
          variant="outline"
          size="icon"
          className="-m-0.5 size-6 shrink-0 rounded-full bg-muted text-muted-foreground"
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
        >
          <UserCircle2 className="size-3.5" strokeWidth={1.75} aria-hidden />
        </Button>
      </div>
      {menu}
    </>
  );
}

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
  validationEnabledProject: boolean;
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
  /** Persist agent / model / YOLO for this task (same fields as task detail & `fluxx tasks update`). */
  onTaskAgentSpawnPrefsChange: (taskId: string, patch: TaskAgentSpawnPatch) => void;
  /** Persist execution device for this task (same path as task detail picker). */
  onTaskExecutionDeviceChange: (taskId: string, ref: TaskExecutionDeviceRef) => void;
  /** Daemon session for this task (gates device edits while running). */
  taskWorkspaceSessionStatus?: SessionStatus;
  /** True when a daemon session exists for this task (main-window session tab can be opened). */
  canOpenTaskWorkspaceTab: boolean;
  /** Opens the task’s daemon session in a main-window tab (same as task detail “Open in tab”). */
  onOpenTaskWorkspaceTab: (taskId: string) => void;
  executionDevices?: ExecutionDeviceConfig[];
  executionDeviceDefaults?: ExecutionDeviceDefaults;
  cloudProject?: boolean;
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
  validationEnabledProject,
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
  onTaskExecutionDeviceChange,
  taskWorkspaceSessionStatus,
  canOpenTaskWorkspaceTab,
  onOpenTaskWorkspaceTab,
  executionDevices = [],
  executionDeviceDefaults,
  cloudProject = false,
}: Props) {
  const chipDeviceRef = useMemo(
    () =>
      resolveTaskChipExecutionDevice(task, executionDeviceDefaults, {
        cloudProject,
      }),
    [task, task.executionDevice, executionDeviceDefaults, cloudProject],
  );

  const isNeedsInput = task.status === 'needs-input';
  const isValidation = task.status === 'validation';
  const isReview = task.status === 'review';
  const isDone = task.status === 'done';
  const workspaceCleaned = Boolean(task.workspaceCleanedAt);
  const blocked = isTaskBlocked(task, allTasks);
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
      ? `${branchChipLabel} — Fluxx will create this branch when the task starts`
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
        <Card
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            'group rounded-lg border border-border bg-card py-0 shadow-md ring-1 ring-border/40 transition-[box-shadow,background-color,border-color]',
            isNeedsInput && 'border-l-[3px] border-l-status-needs-input',
            isValidation && 'border-l-[3px] border-l-status-validation',
            isReview && 'border-l-[3px] border-l-status-review',
            isDone && 'opacity-55',
            snapshot.isDragging
              ? 'border-foreground/15 bg-card shadow-xl brightness-110'
              : 'hover:border-foreground/15 hover:shadow-lg hover:brightness-105',
          )}
        >
          <div
            {...provided.dragHandleProps}
            className="cursor-grab rounded-lg p-3 active:cursor-grabbing"
          >
            <div role="presentation" className="cursor-grab">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 cursor-pointer" onClick={tryOpenTaskDetail}>
                  <p
                    className={cn(
                      'text-[13px] font-medium leading-snug tracking-tight break-words',
                      isDone
                        ? 'text-muted-foreground line-through decoration-muted-foreground/60'
                        : 'text-card-foreground',
                    )}
                  >
                    {task.title}
                  </p>
                  {task.labels && task.labels.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {task.labels.map((lb) =>
                        onLabelClick ? (
                          <Button
                            key={lb}
                            type="button"
                            variant="ghost"
                            title="Filter by this label"
                            aria-label={`Filter board by label ${lb}`}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onLabelClick(lb);
                            }}
                            className="h-auto max-w-full cursor-pointer truncate rounded-full border border-border/80 bg-muted/60 px-2 py-0.5 text-left text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            {lb}
                          </Button>
                        ) : (
                          <Badge
                            key={lb}
                            variant="outline"
                            className="max-w-full truncate rounded-full border-border/80 bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                            title={lb}
                          >
                            {lb}
                          </Badge>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(task.id);
                  }}
                  className="h-auto shrink-0 px-1.5 py-0.5 text-[13px] leading-none text-muted-foreground opacity-0 group-hover:opacity-100"
                  aria-label="Delete task"
                >
                  ×
                </Button>
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
                  {executionDevices.length > 0 && chipDeviceRef ? (
                    <TaskCardExecutionDeviceMenu
                      devices={executionDevices}
                      deviceRef={chipDeviceRef}
                      hasExplicitTaskDevice={Boolean(task.executionDevice)}
                      cloudProject={cloudProject}
                      sessionStatus={taskWorkspaceSessionStatus}
                      onPick={(ref) => onTaskExecutionDeviceChange(task.id, ref)}
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!canOpenTaskWorkspaceTab}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canOpenTaskWorkspaceTab) return;
                      onOpenTaskWorkspaceTab(task.id);
                    }}
                    className={cn(
                      '-m-0.5 size-6 shrink-0',
                      canOpenTaskWorkspaceTab
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/25 hover:bg-transparent disabled:opacity-100',
                    )}
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
                    <Terminal
                      className={cn(
                        'size-3.5 shrink-0',
                        !canOpenTaskWorkspaceTab && 'opacity-60',
                      )}
                      strokeWidth={2}
                      aria-hidden
                    />
                  </Button>
                  {repoChip ? (
                    <Badge
                      role="img"
                      title={repoChip.title}
                      aria-label={repoChip.title}
                      variant="outline"
                      className="max-w-[10rem] shrink-0 gap-0.5 truncate rounded border-status-success/30 bg-status-success/10 px-1.5 py-0.5 text-[10px] font-medium text-status-success-foreground"
                    >
                      <FolderGit2 className="size-3 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                      <span className="truncate" aria-hidden>
                        {repoChip.label}
                      </span>
                    </Badge>
                  ) : null}
                  {showBranchChip ? (
                    <Badge
                      role="img"
                      title={branchChipTitle}
                      aria-label={branchChipTitle}
                      variant="outline"
                      className="max-w-[11rem] gap-0.5 truncate rounded border-status-review/30 bg-status-review/10 px-1.5 py-0.5 text-[10px] font-medium text-status-review-foreground"
                    >
                      <GitBranch className="size-3 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                      <span className="truncate font-mono" aria-hidden>
                        {branchChipLabel}
                      </span>
                    </Badge>
                  ) : null}
                  {validationEnabledProject ? <TaskCardValidationBadge task={task} /> : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {blocked && !isDone ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
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
                      className={cn(
                        '-m-0.5 size-6 shrink-0',
                        unblockToggleLockedByOtherAssignee
                          ? 'border-border bg-muted/50 text-muted-foreground opacity-80'
                          : effectiveUnblockAutostart
                            ? 'border-status-success/35 bg-status-success/10 text-status-success-foreground hover:bg-status-success/15'
                            : 'border-status-needs-input/30 bg-status-needs-input/10 text-status-needs-input-foreground hover:bg-status-needs-input/15',
                      )}
                    >
                      {effectiveUnblockAutostart ? (
                        <CirclePlay className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      ) : (
                        <Ban className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      )}
                    </Button>
                  ) : null}
                  {onTaskPrClick && hasWorktree ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={prLoading}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTaskPrClick(task.id);
                      }}
                      className={cn(
                        '-m-0.5 size-6 shrink-0',
                        prMerged && 'text-status-validation hover:bg-status-validation/10 hover:text-status-validation',
                        prIsOpen && 'text-status-success hover:bg-status-success/10 hover:text-status-success',
                        prLinked && 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        prAwaitingAgent && 'text-status-needs-input hover:bg-status-needs-input/10 hover:text-status-needs-input',
                        !prMerged && !prIsOpen && !prLinked && !prAwaitingAgent && 'text-muted-foreground',
                      )}
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
                          className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                          aria-hidden
                        />
                      ) : prMerged ? (
                        <GitMerge className="size-3.5" strokeWidth={2} aria-hidden />
                      ) : prLinked ? (
                        <GitPullRequest className="size-3.5" strokeWidth={2} aria-hidden />
                      ) : (
                        <GitPullRequestCreate className="size-3.5" strokeWidth={2} aria-hidden />
                      )}
                    </Button>
                  ) : null}
                  {isDone && onRequestCleanupTask ? (
                    workspaceCleaned ? (
                      <span
                        className="-m-0.5 flex size-6 cursor-default items-center justify-center rounded text-muted-foreground/45 opacity-50"
                        title="task cleaned"
                        aria-label="Task workspace already cleaned"
                      >
                        <Icon
                          iconNode={broom}
                          size={14}
                          strokeWidth={1.75}
                          className="text-muted-foreground/70"
                          aria-hidden
                        />
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={cleanupLoading}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestCleanupTask(task.id);
                        }}
                        className="-m-0.5 size-6 shrink-0 text-muted-foreground"
                        aria-label={
                          cleanupLoading
                            ? 'Cleaning up workspace…'
                            : 'Clean up workspace for this task'
                        }
                        title={cleanupLoading ? 'Cleaning up…' : 'Clean up workspace'}
                      >
                        {cleanupLoading ? (
                          <Loader2
                            className="size-3.5 shrink-0 animate-spin text-muted-foreground"
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
                      </Button>
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
                    className={cn('size-1.5 rounded-full', STATUS_DOT[task.status])}
                    aria-hidden
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}
    </Draggable>
  );
}
