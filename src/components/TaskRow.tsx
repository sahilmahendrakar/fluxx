import type { MouseEvent } from 'react';
import { BotOff, GitBranch } from 'lucide-react';
import { modelSummaryForTask } from '../agentModelUi';
import type { ProjectMember } from '../renderer/projects/members';
import { effectiveTaskSourceBranchShort, taskCardShouldShowSourceBranchChip } from '../taskBranches';
import { Task } from '../types';
import AgentBadge from './AgentBadge';
import { GithubPrIconButton } from './GithubPrIconButton';
import { ProjectMemberAvatar } from './ProjectMemberAvatar';

const STATUS_DOT: Record<Task['status'], string> = {
  'in-progress': 'bg-emerald-400/80',
  'needs-input': 'bg-amber-400/80',
  review: 'bg-sky-400/85',
  backlog: 'bg-zinc-600',
  done: 'bg-zinc-600',
};

const LABEL_PILL_CLASS =
  'max-w-full truncate rounded-full border border-violet-400/20 bg-gradient-to-b from-violet-500/12 to-violet-600/8 px-2 py-0.5 text-[10px] font-medium text-violet-200/90 ring-1 ring-inset ring-violet-500/10';

const UNASSIGNED_AGENT_CHIP =
  'border-zinc-600/40 bg-white/[0.04] text-zinc-400/90 ring-1 ring-inset ring-white/[0.06]';

const MAX_VISIBLE_LABELS = 2;

export interface TaskRowProps {
  task: Task;
  onCardClick: (id: string) => void;
  onLabelClick?: (label: string) => void;
  assigneeMember?: ProjectMember;
  onTaskPrClick?: (taskId: string) => void;
  prLoading?: boolean;
  prAgentAwaiting?: boolean;
  repoDefaultBranchShort: string;
  /** When set, branch chip compares against this repo's default (multi-repo), not the board-wide default. */
  branchChipCompareShort?: string;
  /** When false, the GitHub PR control is hidden (no local/session worktree). */
  hasWorktree?: boolean;
}

export function TaskRow({
  task,
  onCardClick,
  onLabelClick,
  assigneeMember,
  onTaskPrClick,
  prLoading = false,
  prAgentAwaiting = false,
  repoDefaultBranchShort,
  branchChipCompareShort,
  hasWorktree = false,
}: TaskRowProps) {
  const isDone = task.status === 'done';
  const branchCompareShort = branchChipCompareShort ?? repoDefaultBranchShort;
  const showBranchChip = taskCardShouldShowSourceBranchChip(task, branchCompareShort);
  const branchChipLabel = effectiveTaskSourceBranchShort(task, branchCompareShort);
  const branchChipTitle =
    task.createSourceBranchIfMissing === true
      ? `${branchChipLabel} — Flux will create this branch when the task starts`
      : `Source branch: ${branchChipLabel}`;

  const labels = task.labels ?? [];
  const visibleLabels = labels.slice(0, MAX_VISIBLE_LABELS);
  const extraLabelCount = labels.length - visibleLabels.length;

  const hasAssigneeUid = Boolean(task.assigneeId?.trim());
  const agentSummary = modelSummaryForTask(task);

  const openTaskDetail = () => onCardClick(task.id);

  const stopRowActivation = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      onClick={openTaskDetail}
      className={`group flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition hover:border-white/[0.06] hover:bg-white/[0.03] ${
        isDone ? 'opacity-55' : ''
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[task.status]}`}
        aria-hidden
      />

      <span
        className={`min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight ${
          isDone ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-200'
        }`}
        title={task.title}
      >
        {task.title}
      </span>

      {visibleLabels.length > 0 ? (
        <div className="flex min-w-0 shrink items-center gap-1" onClick={stopRowActivation}>
          {visibleLabels.map((lb) =>
            onLabelClick ? (
              <button
                key={lb}
                type="button"
                title="Filter by this label"
                aria-label={`Filter board by label ${lb}`}
                onMouseDown={stopRowActivation}
                onClick={(e) => {
                  stopRowActivation(e);
                  onLabelClick(lb);
                }}
                className={`${LABEL_PILL_CLASS} cursor-pointer transition hover:border-violet-400/35 hover:from-violet-500/18 hover:to-violet-600/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50`}
              >
                {lb}
              </button>
            ) : (
              <span key={lb} className={LABEL_PILL_CLASS} title={lb}>
                {lb}
              </span>
            ),
          )}
          {extraLabelCount > 0 ? (
            <span
              className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
              title={labels.slice(MAX_VISIBLE_LABELS).join(', ')}
            >
              +{extraLabelCount}
            </span>
          ) : null}
        </div>
      ) : null}

      {showBranchChip ? (
        <span
          role="img"
          title={branchChipTitle}
          aria-label={branchChipTitle}
          className="inline-flex max-w-[9rem] shrink-0 items-center gap-0.5 truncate rounded border border-sky-500/25 bg-sky-500/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-sky-200/90"
          onClick={stopRowActivation}
        >
          <GitBranch className="h-3 w-3 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
          <span className="truncate font-mono" aria-hidden>
            {branchChipLabel}
          </span>
        </span>
      ) : null}

      <span className="shrink-0" onClick={stopRowActivation}>
        {task.agent != null ? (
          <AgentBadge agent={task.agent} summary={agentSummary} variant="icon" />
        ) : (
          <span
            title="No agent"
            aria-label="No agent assigned"
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md border ${UNASSIGNED_AGENT_CHIP}`}
          >
            <BotOff className="h-3.5 w-3.5 text-zinc-500/90" strokeWidth={2} aria-hidden />
          </span>
        )}
      </span>

      <span className="shrink-0" onClick={stopRowActivation}>
        {assigneeMember ? (
          <ProjectMemberAvatar member={assigneeMember} size="sm" />
        ) : hasAssigneeUid ? (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-500/[0.15] text-[10px] font-medium text-zinc-400 ring-1 ring-white/10"
            title="Unknown member"
            aria-label="Assignee is an unknown member"
          >
            ?
          </span>
        ) : null}
      </span>

      <span onClick={stopRowActivation} onMouseDown={stopRowActivation}>
        <GithubPrIconButton
          githubPr={task.githubPr}
          taskId={task.id}
          hasWorktree={hasWorktree}
          onTaskPrClick={onTaskPrClick}
          prLoading={prLoading}
          prAgentAwaiting={prAgentAwaiting}
        />
      </span>
    </div>
  );
}
