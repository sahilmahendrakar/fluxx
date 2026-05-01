import { useState } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { broom } from '@lucide/lab';
import { Icon } from 'lucide-react';
import { Task } from '../types';
import { getBlockedTasks, isTaskBlocked } from '../taskDependencies';
import { modelSummaryForTask } from '../agentModelUi';
import AgentBadge from './AgentBadge';
import type { ProjectMember } from '../renderer/projects/members';

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
  autoStartWhenUnblockedProject: boolean;
  onToggleTaskAutoStartOnUnblock: (taskId: string, enabled: boolean) => void;
  assigneeMember?: ProjectMember;
}

const AVATAR_COLORS = [
  '#7c3aed',
  '#2563eb',
  '#059669',
  '#d97706',
  '#e11d48',
  '#0891b2',
  '#4f46e5',
  '#0d9488',
];

function avatarBg(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function AssigneeAvatar({ member }: { member: ProjectMember }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initial = (member.displayName || member.email)[0]?.toUpperCase() ?? '?';
  if (member.photoURL && !imgFailed) {
    return (
      <img
        src={member.photoURL}
        alt={member.displayName || member.email}
        onError={() => setImgFailed(true)}
        className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-white/10"
        title={member.displayName || member.email}
      />
    );
  }
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-1 ring-white/10"
      style={{ backgroundColor: avatarBg(member.uid) }}
      title={member.displayName || member.email}
    >
      {initial}
    </span>
  );
}

export default function TaskCard({
  task,
  allTasks,
  index,
  onDelete,
  onRequestCleanupTask,
  cleanupLoading = false,
  onCardClick,
  autoStartWhenUnblockedProject,
  onToggleTaskAutoStartOnUnblock,
  assigneeMember,
}: Props) {
  const isNeedsInput = task.status === 'needs-input';
  const isDone = task.status === 'done';
  const workspaceCleaned = Boolean(task.workspaceCleanedAt);
  const agentBadgeTitle = modelSummaryForTask(task);
  const blocked = isTaskBlocked(task, allTasks);
  const blocksCount = getBlockedTasks(task.id, allTasks).length;
  const perTaskUnblockAuto = task.autoStartOnUnblock === true;
  const projectUnblockAuto = autoStartWhenUnblockedProject;

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
                      {task.labels.map((lb) => (
                        <span
                          key={lb}
                          className="max-w-full truncate rounded-full border border-violet-400/20 bg-gradient-to-b from-violet-500/12 to-violet-600/8 px-2 py-0.5 text-[10px] font-medium text-violet-200/90 ring-1 ring-inset ring-violet-500/10"
                          title={lb}
                        >
                          {lb}
                        </span>
                      ))}
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
                <AgentBadge agent={task.agent} title={agentBadgeTitle} />
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {blocked && !isDone ? (
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleTaskAutoStartOnUnblock(task.id, !perTaskUnblockAuto);
                      }}
                      title={
                        perTaskUnblockAuto
                          ? 'Per-task auto-start when unblocked is on — click to turn off'
                          : projectUnblockAuto
                            ? 'This project auto-starts when unblocked — click to add a per-task override (on)'
                            : 'Click to auto-start a session when the last dependency completes (this task)'
                      }
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition ${
                        perTaskUnblockAuto
                          ? 'border-emerald-500/35 bg-emerald-500/[0.1] text-emerald-200/90 hover:border-emerald-400/45'
                          : projectUnblockAuto
                            ? 'border-sky-500/30 bg-sky-500/[0.08] text-sky-200/90 hover:border-sky-400/40'
                            : 'border-amber-500/25 bg-amber-500/[0.08] text-amber-200/90 hover:border-amber-400/35'
                      }`}
                    >
                      {perTaskUnblockAuto
                        ? 'Auto (task)'
                        : projectUnblockAuto
                          ? 'Auto (project)'
                          : 'Blocked'}
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
                        className="-m-0.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label="Clean up workspace for this task"
                        title="Clean up workspace"
                      >
                        <Icon
                          iconNode={broom}
                          size={14}
                          strokeWidth={1.75}
                          className={cleanupLoading ? 'animate-pulse opacity-50' : ''}
                          aria-hidden
                        />
                      </button>
                    )
                  ) : null}
                  {assigneeMember ? (
                    <AssigneeAvatar member={assigneeMember} />
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
