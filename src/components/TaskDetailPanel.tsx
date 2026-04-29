import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Settings } from 'lucide-react';
import {
  Task,
  TaskStatus,
  COLUMNS,
  AGENTS,
  Agent,
  Session,
  DEFAULT_CURSOR_AGENT_MODEL,
  claudeCodeExplicitModel,
  resolvedCursorAgentModel,
} from '../types';
import {
  getBlockingTasks,
  isTaskBlocked,
  validateBlockedByTaskIds,
} from '../taskDependencies';
import AgentModelPicker from './AgentModelPicker';
import { AGENT_CHIP_STYLES } from './AgentBadge';
import {
  applyAttachResultToTerminal,
  getSessionAttachShared,
  type BufferedStreamChunk,
  writeBufferedStreamAfterSnapshot,
} from '../terminal/warmAttach';
import Terminal, { type TerminalHandle } from './Terminal';

interface TaskDetailPanelProps {
  task: Task | null;
  /** Full board snapshot for dependencies and session start (same `projectId`). */
  projectTasks: Task[];
  onSelectTask: (id: string) => void;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
  /** Present when a teammate (not the current user) is running an agent on this task. */
  remoteRunner?: { displayName?: string } | null;
  onOpenSessionTab: (session: Session) => void;
  onArchiveSession: (sessionId: string) => void;
}

const TASK_DETAIL_WIDTH_KEY = 'flux.taskDetailPanelWidth';
const DEFAULT_DETAIL_WIDTH = 420;
const MIN_DETAIL_WIDTH = 280;
const MIN_BOARD_REMAINING_PX = 200;

function clampDetailWidth(width: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(MIN_DETAIL_WIDTH, Math.round(width)));
}

function readStoredDetailWidth(): number | null {
  try {
    const raw = localStorage.getItem(TASK_DETAIL_WIDTH_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const STATUS_BADGE: Record<TaskStatus, string> = {
  backlog: 'border-white/[0.08] bg-white/[0.04] text-zinc-400 ring-1 ring-inset ring-white/[0.04]',
  'in-progress':
    'border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-200/90 ring-1 ring-inset ring-emerald-500/10',
  'needs-input':
    'border-amber-500/25 bg-amber-500/[0.1] text-amber-200/90 ring-1 ring-inset ring-amber-500/12',
  done: 'border-white/[0.06] bg-white/[0.03] text-zinc-500 ring-1 ring-inset ring-white/[0.04]',
};

function formatCreatedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const formatted = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `Created ${formatted}`;
}

function useAutosizeTextArea(value: string, minHeightPx = 0) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.max(minHeightPx, el.scrollHeight);
    el.style.height = `${next}px`;
  }, [minHeightPx]);

  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  return { ref, resize };
}

export default function TaskDetailPanel({
  task,
  projectTasks,
  onSelectTask,
  onClose,
  onUpdate,
  onDelete,
  remoteRunner,
  onOpenSessionTab,
  onArchiveSession,
}: TaskDetailPanelProps) {
  const asideRef = useRef<HTMLElement>(null);
  const [detailWidth, setDetailWidth] = useState(DEFAULT_DETAIL_WIDTH);
  const titleArea = useAutosizeTextArea(task?.title ?? '');
  const descriptionArea = useAutosizeTextArea(task?.description ?? '', 120);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const [depSearch, setDepSearch] = useState('');
  const terminalRef = useRef<TerminalHandle | null>(null);

  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const agentSettingsWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAgentSettingsOpen(false);
    setDependencyError(null);
    setDepSearch('');
  }, [task?.id]);

  useEffect(() => {
    if (!agentSettingsOpen) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const root = agentSettingsWrapRef.current;
      if (root && !root.contains(e.target as Node)) {
        setAgentSettingsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [agentSettingsOpen]);

  const maxDetailWidthForParent = useCallback(() => {
    const parent = asideRef.current?.parentElement;
    const w = parent?.getBoundingClientRect().width ?? window.innerWidth;
    return Math.max(MIN_DETAIL_WIDTH, w - MIN_BOARD_REMAINING_PX);
  }, []);

  useEffect(() => {
    const stored = readStoredDetailWidth();
    if (stored != null) {
      setDetailWidth(clampDetailWidth(stored, maxDetailWidthForParent()));
    }
  }, [maxDetailWidthForParent]);

  useEffect(() => {
    const onResize = () => {
      setDetailWidth((prev) => clampDetailWidth(prev, maxDetailWidthForParent()));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [maxDetailWidthForParent]);

  const persistDetailWidth = useCallback((w: number) => {
    try {
      localStorage.setItem(TASK_DETAIL_WIDTH_KEY, String(w));
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const handleResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget;
      const startX = e.clientX;
      const startW = detailWidth;
      const maxW = maxDetailWidthForParent();
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: globalThis.PointerEvent) => {
        const next = startW + (startX - ev.clientX);
        setDetailWidth(clampDetailWidth(next, maxW));
      };

      const onUp = (ev: globalThis.PointerEvent) => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        setDetailWidth((prev) => {
          const capped = clampDetailWidth(prev, maxDetailWidthForParent());
          persistDetailWidth(capped);
          return capped;
        });
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [detailWidth, maxDetailWidthForParent, persistDetailWidth],
  );

  const handleResizeDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const maxW = maxDetailWidthForParent();
      const next = clampDetailWidth(DEFAULT_DETAIL_WIDTH, maxW);
      setDetailWidth(next);
      persistDetailWidth(next);
    },
    [maxDetailWidthForParent, persistDetailWidth],
  );

  useEffect(() => {
    if (!task) return;
    setSessionError(null);
    let cancelled = false;
    setSession(null);
    void window.electronAPI.sessions.get(task.id).then((existingSession) => {
      if (cancelled) return;
      if (existingSession && existingSession.status === 'running') {
        setSession(existingSession);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [task?.id]);

  useEffect(() => {
    if (!session) return;
    const unsubExit = window.electronAPI.sessions.onExit((exitedSession) => {
      if (exitedSession.id === session.id) {
        setSession((prev) => (prev ? { ...prev, status: exitedSession.status } : null));
      }
    });
    return () => {
      unsubExit();
    };
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    const id = session.id;

    // Match SessionTerminalView.AgentPane: in-flight attach coalescing and
    // snapshot restore so StrictMode does not double-apply or re-replay
    // raw PTY buffers when a serialized snapshot is available.
    let streamReady = false;
    const earlyBuffer: BufferedStreamChunk[] = [];
    let cancelled = false;

    const unsub = window.electronAPI.sessions.onData(id, (data, streamSeq) => {
      if (cancelled) return;
      if (!streamReady) {
        earlyBuffer.push({ data, streamSeq });
      } else {
        terminalRef.current?.write(data);
      }
    });

    void (async () => {
      const result = await getSessionAttachShared(id, async () => {
        try {
          return await window.electronAPI.sessions.attach(id);
        } catch (err) {
          console.error('[TaskDetailPanel] attach failed', err);
          return null;
        }
      });
      if (cancelled) return;
      applyAttachResultToTerminal(terminalRef.current, result, () => {
        if (cancelled) return;
        streamReady = true;
        writeBufferedStreamAfterSnapshot(terminalRef.current, earlyBuffer, result?.streamSeq);
        earlyBuffer.length = 0;
      }, {
        applyGeometry: false,
        useSnapshot: false,
      });
    })();

    return () => {
      cancelled = true;
      unsub();
    };
  }, [session?.id]);

  useEffect(() => {
    if (!task) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [task, onClose]);

  useLayoutEffect(() => {
    if (task == null) return;
    setDetailWidth((prev) => clampDetailWidth(prev, maxDetailWidthForParent()));
  }, [task?.id, maxDetailWidthForParent]);

  const handleStartSession = async () => {
    if (!task) return;
    if (isTaskBlocked(task, projectTasks)) {
      setSessionError('Finish blocking tasks before starting a session.');
      return;
    }
    setSessionLoading(true);
    setSessionError(null);
    try {
      const result = await window.electronAPI.sessions.start(task, projectTasks);
      if ('error' in result) {
        if (result.error === 'TASK_BLOCKED') {
          setSessionError(result.message ?? 'This task is blocked by incomplete work.');
        } else {
          setSessionError(result.message ?? result.error);
        }
        return;
      }
      setSession(result);
      onUpdate(task.id, { status: 'in-progress' });
    } catch {
      setSessionError('Failed to start session');
    } finally {
      setSessionLoading(false);
    }
  };

  const handleArchiveFromPanel = () => {
    if (!session) return;
    onArchiveSession(session.id);
    setSession(null);
  };

  const handleOpenInTab = () => {
    if (!session) return;
    onOpenSessionTab(session);
  };

  const handleTerminalData = (data: string) => {
    if (session?.status === 'running') {
      window.electronAPI.sessions.write(session.id, data);
    }
  };

  // The panel's embedded terminal is a preview of the running session — it
  // shares the pty with the workspace tab's terminal. We intentionally do NOT
  // push this narrower view's cols/rows to the pty: that would make the pty
  // wrap output to the panel width, which corrupts the workspace terminal's
  // buffer (lines end mid-row, leaving the right side rendered as the theme
  // background — i.e. "blacked out where the panel was" when the user
  // switches back to the workspace tab). The workspace terminal owns pty size.

  const handleDelete = () => {
    if (!task) return;
    if (!window.confirm('Delete this task?')) return;
    onDelete(task.id);
    onClose();
  };

  if (!task) {
    return null;
  }

  const statusLabel = COLUMNS.find((c) => c.id === task.status)?.label ?? task.status;
  const sessionRunning = session?.status === 'running';
  const blocked = isTaskBlocked(task, projectTasks);
  const blockingTasks = getBlockingTasks(task, projectTasks);
  const taskById = new Map(projectTasks.map((t) => [t.id, t]));
  const staleMissingIds = (task.blockedByTaskIds ?? []).filter((id) => !taskById.has(id));
  const depQueryLower = depSearch.trim().toLowerCase();
  const pickCandidates = projectTasks.filter(
    (t) =>
      t.id !== task.id &&
      !(task.blockedByTaskIds ?? []).includes(t.id) &&
      (depQueryLower === '' || t.title.toLowerCase().includes(depQueryLower)),
  );

  const addBlocker = (blockerId: string) => {
    const next = [...(task.blockedByTaskIds ?? []), blockerId];
    const v = validateBlockedByTaskIds(task.id, next, projectTasks, false);
    if (!v.ok) {
      setDependencyError(v.message);
      return;
    }
    setDependencyError(null);
    onUpdate(task.id, { blockedByTaskIds: v.normalized });
    setDepSearch('');
  };

  const removeBlocker = (blockerId: string) => {
    onUpdate(task.id, {
      blockedByTaskIds: (task.blockedByTaskIds ?? []).filter((id) => id !== blockerId),
    });
    setDependencyError(null);
  };

  const startButtonLabel = sessionLoading ? 'Starting…' : sessionError ? 'Retry' : 'Start session';
  const startButtonClass = sessionError
    ? 'rounded-md border border-red-500/25 bg-red-500/[0.08] px-3 py-1.5 text-[12px] font-medium text-red-200/90 transition hover:bg-red-500/[0.12]'
    : sessionLoading
      ? 'cursor-not-allowed rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] font-medium text-zinc-600'
      : 'rounded-md border border-emerald-500/25 bg-emerald-500/[0.1] px-3 py-1.5 text-[12px] font-medium text-emerald-100/90 transition hover:bg-emerald-500/[0.14]';

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close task details"
        className="absolute inset-0 z-10 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        ref={asideRef}
        style={{ width: detailWidth }}
        className="absolute inset-y-0 right-0 z-20 flex min-w-0 flex-col border-l border-white/[0.06] bg-[#0c0c0e] shadow-2xl shadow-black/50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize task details"
          title="Drag to resize. Double-click to reset."
          className="absolute bottom-0 left-0 top-0 z-30 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-white/[0.1] before:content-[''] hover:before:bg-white/[0.22] focus-visible:ring-1 focus-visible:ring-white/25"
          onPointerDown={handleResizePointerDown}
          onDoubleClick={handleResizeDoubleClick}
        />
        <div className="flex shrink-0 flex-col gap-3 border-b border-white/[0.06] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span
                className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] ${STATUS_BADGE[task.status]}`}
              >
                {statusLabel}
              </span>
              <p className="mt-1.5 text-[11px] text-zinc-600">{formatCreatedLabel(task.createdAt)}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                {!sessionRunning ? (
                  <button
                    type="button"
                    onClick={handleStartSession}
                    disabled={sessionLoading || blocked}
                    title={blocked ? 'Blocked by incomplete dependencies' : undefined}
                    className={
                      blocked
                        ? 'cursor-not-allowed rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[12px] font-medium text-zinc-600'
                        : startButtonClass
                    }
                  >
                    {blocked ? 'Blocked' : startButtonLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 rounded-md p-1 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
                  aria-label="Close"
                >
                  <span className="text-lg leading-none" aria-hidden>
                    ×
                  </span>
                </button>
              </div>
              {sessionError && !sessionRunning ? (
                <p className="mt-1 max-w-[220px] text-right text-[11px] text-red-300/90">{sessionError}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
            <textarea
              id="task-detail-title"
              ref={titleArea.ref}
              value={task.title}
              rows={1}
              onChange={(e) => {
                onUpdate(task.id, { title: e.target.value });
                titleArea.resize();
              }}
              className="w-full resize-none bg-transparent text-xl font-semibold leading-snug tracking-tight text-zinc-100 outline-none focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              placeholder="Title"
            />

            <div>
              <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-2 text-[13px]">
                <dt className="text-zinc-600">Agent</dt>
                <dd className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <select
                      value={task.agent}
                      onChange={(e) => {
                        const next = e.target.value as Agent;
                        const patch: Partial<Task> = { agent: next };
                        if (next !== task.agent) {
                          patch.agentYolo = false;
                          patch.agentModel =
                            next === 'cursor' ? DEFAULT_CURSOR_AGENT_MODEL : '';
                        }
                        onUpdate(task.id, patch);
                      }}
                      className={`w-auto max-w-full shrink-0 cursor-pointer rounded-md border px-2.5 py-1 pr-8 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${AGENT_CHIP_STYLES[task.agent]}`}
                      aria-label="Agent provider"
                    >
                      {AGENTS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    {task.agent === 'cursor' ? (
                      <AgentModelPicker
                        kind="cursor"
                        modelId={resolvedCursorAgentModel(task)}
                        onModelIdChange={(id) =>
                          onUpdate(task.id, {
                            agentModel: id.trim() || DEFAULT_CURSOR_AGENT_MODEL,
                          })
                        }
                        aria-label="Cursor model"
                      />
                    ) : task.agent === 'claude-code' ? (
                      <AgentModelPicker
                        kind="claude-code"
                        modelId={claudeCodeExplicitModel(task) ?? ''}
                        onModelIdChange={(id) =>
                          onUpdate(task.id, {
                            agentModel: id.trim(),
                          })
                        }
                        aria-label="Claude Code model"
                      />
                    ) : (
                      <span
                        className="truncate text-[12px] text-zinc-500"
                        title="Model selection is not wired for Codex in this version."
                      >
                        Model: default
                      </span>
                    )}
                    <div ref={agentSettingsWrapRef} className="relative shrink-0">
                      <button
                        type="button"
                        aria-label="Agent spawn settings"
                        aria-expanded={agentSettingsOpen}
                        onClick={() => setAgentSettingsOpen((o) => !o)}
                        className="rounded-md p-1 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/[0.12]"
                      >
                        <Settings className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                      </button>
                      {agentSettingsOpen ? (
                        <div
                          className="absolute right-0 z-40 mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-md border border-white/[0.1] bg-[#121214] p-3 text-[12px] shadow-xl shadow-black/40"
                          role="dialog"
                          aria-label="Agent settings"
                        >
                          {task.agent === 'cursor' ? (
                            <label className="flex cursor-pointer items-start gap-2 text-zinc-200">
                              <input
                                type="checkbox"
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-white/[0.2] bg-[#09090b]"
                                checked={task.agentYolo === true}
                                onChange={(e) =>
                                  onUpdate(task.id, { agentYolo: e.target.checked })
                                }
                              />
                              <span className="leading-snug">
                                <span className="font-medium text-zinc-100">YOLO (Run Everything)</span>
                                <span className="mt-1 block text-[11px] text-zinc-500">
                                  Matches Cursor Agent{' '}
                                  <code className="text-zinc-400">--yolo</code> /{' '}
                                  <code className="text-zinc-400">--force</code>: fewer confirmation
                                  prompts; tools and shell commands run more freely unless explicitly
                                  denied.
                                </span>
                              </span>
                            </label>
                          ) : task.agent === 'claude-code' ? (
                            <label className="flex cursor-pointer items-start gap-2 text-zinc-200">
                              <input
                                type="checkbox"
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-white/[0.2] bg-[#09090b]"
                                checked={task.agentYolo === true}
                                onChange={(e) =>
                                  onUpdate(task.id, { agentYolo: e.target.checked })
                                }
                              />
                              <span className="leading-snug">
                                <span className="font-medium text-zinc-100">
                                  Skip permission checks
                                </span>
                                <span className="mt-1 block text-[11px] text-zinc-500">
                                  Passes <code className="text-zinc-400">--dangerously-skip-permissions</code>{' '}
                                  to Claude Code (bypasses permission prompts). Anthropic recommends
                                  this only for trusted sandboxes; treat it like Cursor YOLO.
                                </span>
                              </span>
                            </label>
                          ) : (
                            <p className="leading-relaxed text-zinc-500">
                              No spawn toggles for Codex in this version.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </dd>
                <dt className="text-zinc-600">Status</dt>
                <dd>
                  <select
                    value={task.status}
                    onChange={(e) => onUpdate(task.id, { status: e.target.value as TaskStatus })}
                    className="w-full max-w-[220px] cursor-pointer rounded-md border border-white/[0.08] bg-[#09090b] px-2 py-1.5 text-[13px] text-zinc-200 outline-none focus-visible:border-white/[0.14] focus-visible:ring-1 focus-visible:ring-white/[0.12]"
                    aria-label="Change status"
                  >
                    {COLUMNS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </dd>
              </dl>
            </div>

            <div className="flex flex-col">
              <label
                htmlFor="task-detail-description"
                className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600"
              >
                Description
              </label>
              <textarea
                id="task-detail-description"
                ref={descriptionArea.ref}
                value={task.description ?? ''}
                onChange={(e) => {
                  onUpdate(task.id, { description: e.target.value });
                  descriptionArea.resize();
                }}
                placeholder="Add a description..."
                className="min-h-[120px] w-full resize-none rounded-md border border-white/[0.08] bg-[#09090b] p-3 text-[13px] leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus-visible:border-white/[0.14] focus-visible:ring-1 focus-visible:ring-white/[0.12]"
              />
            </div>

            {(blockingTasks.length > 0 || staleMissingIds.length > 0) && (
              <div className="rounded-md border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-[12px] leading-relaxed text-amber-100/90">
                {blockingTasks.length > 0 ? (
                  <>
                    <span className="font-medium">Blocked</span>
                    <span className="text-amber-200/85">
                      {' '}
                      — finish {blockingTasks.length === 1 ? 'this task' : 'these tasks'} first:{' '}
                      {blockingTasks.map((b) => b.title || '(Untitled)').join(', ')}
                    </span>
                  </>
                ) : null}
                {staleMissingIds.length > 0 ? (
                  <span
                    className={`block text-[11px] text-amber-200/70 ${blockingTasks.length > 0 ? 'mt-1' : ''}`}
                  >
                    {staleMissingIds.length} missing reference
                    {staleMissingIds.length === 1 ? '' : 's'} on the board (remove below).
                  </span>
                ) : null}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600">
                Dependencies
              </span>
              <p className="text-[11px] leading-relaxed text-zinc-600">
                This task stays blocked until every listed dependency is marked done (missing ids are
                ignored for blocking).
              </p>
              {(task.blockedByTaskIds ?? []).length === 0 ? (
                <p className="text-[12px] text-zinc-500">No dependencies yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {(task.blockedByTaskIds ?? []).map((bid) => {
                    const other = taskById.get(bid);
                    if (other) {
                      const stLabel = COLUMNS.find((c) => c.id === other.status)?.label ?? other.status;
                      return (
                        <li
                          key={bid}
                          className="flex items-center justify-between gap-2 rounded-md border border-white/[0.06] bg-[#09090b] px-2 py-1.5"
                        >
                          <button
                            type="button"
                            onClick={() => onSelectTask(bid)}
                            className="min-w-0 flex-1 truncate text-left text-[12px] text-zinc-200 transition hover:text-white"
                          >
                            <span className="font-medium">{other.title || '(Untitled)'}</span>
                            <span className="ml-2 text-zinc-500">· {stLabel}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeBlocker(bid)}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                          >
                            Remove
                          </button>
                        </li>
                      );
                    }
                    return (
                      <li
                        key={bid}
                        className="flex items-center justify-between gap-2 rounded-md border border-white/[0.06] bg-[#09090b] px-2 py-1.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-500">
                          Missing task <code className="text-zinc-400">{bid}</code>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeBlocker(bid)}
                          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <input
                type="search"
                value={depSearch}
                onChange={(e) => setDepSearch(e.target.value)}
                placeholder="Search tasks to add…"
                className="w-full rounded-md border border-white/[0.08] bg-[#09090b] px-2 py-1.5 text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600 focus-visible:border-white/[0.14]"
              />
              {dependencyError ? (
                <p className="text-[11px] text-red-300/90">{dependencyError}</p>
              ) : null}
              {pickCandidates.length > 0 ? (
                <ul className="max-h-40 overflow-y-auto rounded-md border border-white/[0.06] bg-[#09090b] py-1">
                  {pickCandidates.slice(0, 50).map((t) => {
                    const stLabel = COLUMNS.find((c) => c.id === t.status)?.label ?? t.status;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => addBlocker(t.id)}
                          className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-white/[0.04]"
                        >
                          <span className="min-w-0 truncate">{t.title || '(Untitled)'}</span>
                          <span className="shrink-0 text-[11px] text-zinc-500">{stLabel}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : depSearch.trim() ? (
                <p className="text-[11px] text-zinc-600">No matching tasks.</p>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-[200px] flex-1 flex-col overflow-hidden border-t border-white/[0.06]">
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600">
                Session
              </span>
              {sessionRunning ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenInTab}
                    className="text-[11px] font-medium text-zinc-400 transition hover:text-zinc-200"
                  >
                    Open in tab
                  </button>
                  <button
                    type="button"
                    onClick={handleArchiveFromPanel}
                    className="text-[11px] font-medium text-red-400/90 transition hover:text-red-300"
                    title="Archive — kill agent and terminals, keep worktree"
                  >
                    Archive
                  </button>
                </div>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
              {blocked && !sessionRunning && !session ? (
                <div className="mb-2 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-100/90">
                  Session start is disabled until blocking tasks are done.
                </div>
              ) : null}
              {remoteRunner && !session ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[13px] leading-relaxed text-zinc-500">
                  <div className="flex items-center gap-2 text-zinc-300">
                    <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                    <span className="font-medium">
                      {remoteRunner.displayName ?? 'A teammate'} is running an agent
                    </span>
                  </div>
                  <p className="max-w-xs text-zinc-500">
                    Terminal output stays on their machine for now. You'll see
                    status updates here as they work.
                  </p>
                </div>
              ) : (
                <Terminal
                  ref={terminalRef}
                  sessionId={session?.id ?? null}
                  onData={handleTerminalData}
                  hideCursor
                />
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-white/[0.06] p-4">
          <button
            type="button"
            onClick={handleDelete}
            className="text-[13px] text-zinc-500 transition hover:text-red-400/90"
          >
            Delete task
          </button>
        </div>
      </aside>
    </>
  );
}
