import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Task, TaskStatus, COLUMNS, AGENTS, Agent, Session } from '../types';
import AgentBadge from './AgentBadge';
import Terminal, { type TerminalHandle } from './Terminal';

interface TaskDetailPanelProps {
  task: Task | null;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
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
  backlog: 'bg-gray-700 text-gray-300',
  'in-progress': 'bg-green-900/60 text-green-300',
  'needs-input': 'bg-amber-900/60 text-amber-300',
  done: 'bg-gray-700 text-gray-400',
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
  onClose,
  onUpdate,
  onDelete,
}: TaskDetailPanelProps) {
  const asideRef = useRef<HTMLElement>(null);
  const [detailWidth, setDetailWidth] = useState(DEFAULT_DETAIL_WIDTH);
  const titleArea = useAutosizeTextArea(task?.title ?? '');
  const descriptionArea = useAutosizeTextArea(task?.description ?? '', 120);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const terminalRef = useRef<TerminalHandle | null>(null);

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
    const unsub = window.electronAPI.sessions.onData(session.id, (data) => {
      terminalRef.current?.write(data);
    });
    const unsubExit = window.electronAPI.sessions.onExit((exitedSession) => {
      if (exitedSession.id === session.id) {
        setSession((prev) => (prev ? { ...prev, status: exitedSession.status } : null));
      }
    });
    return () => {
      unsub();
      unsubExit();
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
    setSessionLoading(true);
    setSessionError(null);
    try {
      const result = await window.electronAPI.sessions.start(task);
      if ('error' in result) {
        setSessionError(result.message ?? result.error);
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

  const handleStopSession = async () => {
    if (!session) return;
    await window.electronAPI.sessions.stop(session.id);
    setSession(null);
  };

  const handleTerminalData = (data: string) => {
    if (session?.status === 'running') {
      window.electronAPI.sessions.write(session.id, data);
    }
  };

  const handleTerminalResize = (cols: number, rows: number) => {
    if (session?.status === 'running') {
      window.electronAPI.sessions.resize(session.id, cols, rows);
    }
  };

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

  const startButtonLabel = sessionLoading ? 'Starting...' : sessionError ? 'Retry' : 'Start session';
  const startButtonClass = sessionError
    ? 'rounded-md bg-red-950 px-3 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-900'
    : sessionLoading
      ? 'cursor-not-allowed rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-500'
      : 'rounded-md bg-green-900 px-3 py-1.5 text-xs text-green-300 transition-colors hover:bg-green-800';

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close task details"
        className="absolute inset-0 z-10 bg-black/30"
        onClick={onClose}
      />
      <aside
        ref={asideRef}
        style={{ width: detailWidth }}
        className="absolute inset-y-0 right-0 z-20 flex min-w-0 flex-col border-l border-gray-800 bg-gray-900 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize task details"
          title="Drag to resize. Double-click to reset."
          className="absolute bottom-0 left-0 top-0 z-30 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-gray-600 before:content-[''] hover:before:bg-purple-500/80 focus-visible:ring-2 focus-visible:ring-purple-500/50"
          onPointerDown={handleResizePointerDown}
          onDoubleClick={handleResizeDoubleClick}
        />
        <div className="flex shrink-0 flex-col gap-3 border-b border-gray-800 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[task.status]}`}
              >
                {statusLabel}
              </span>
              <p className="mt-1.5 text-xs text-gray-500">{formatCreatedLabel(task.createdAt)}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                {!sessionRunning ? (
                  <button
                    type="button"
                    onClick={handleStartSession}
                    disabled={sessionLoading}
                    className={startButtonClass}
                  >
                    {startButtonLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 rounded p-1 text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
                  aria-label="Close"
                >
                  <span className="text-lg leading-none" aria-hidden>
                    ×
                  </span>
                </button>
              </div>
              {sessionError && !sessionRunning ? (
                <p className="max-w-[220px] text-right text-xs text-red-400 mt-1">{sessionError}</p>
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
              className="w-full resize-none bg-transparent text-2xl font-semibold leading-snug text-white outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              placeholder="Title"
            />

            <div>
              <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-gray-500">Agent</dt>
                <dd className="min-w-0">
                  <div className="relative inline-flex max-w-full">
                    <select
                      value={task.agent}
                      onChange={(e) => onUpdate(task.id, { agent: e.target.value as Agent })}
                      className="absolute inset-0 z-10 h-full min-h-[1.75rem] w-full max-w-full cursor-pointer opacity-0"
                      aria-label="Change agent"
                    >
                      {AGENTS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    <AgentBadge agent={task.agent} />
                  </div>
                </dd>
                <dt className="text-gray-500">Status</dt>
                <dd>
                  <select
                    value={task.status}
                    onChange={(e) => onUpdate(task.id, { status: e.target.value as TaskStatus })}
                    className="w-full max-w-[220px] cursor-pointer rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50"
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
              <label htmlFor="task-detail-description" className="mb-1.5 text-xs text-gray-500">
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
                className="min-h-[120px] w-full resize-none rounded-md border border-gray-700 bg-gray-800 p-3 text-sm leading-relaxed text-gray-100 outline-none placeholder:text-gray-600 focus-visible:ring-2 focus-visible:ring-purple-500/50"
              />
            </div>
          </div>

          <div className="flex min-h-[200px] flex-1 flex-col border-t border-gray-800">
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Session</span>
              {sessionRunning ? (
                <button
                  type="button"
                  onClick={() => void handleStopSession()}
                  className="text-xs text-red-500 hover:text-red-400"
                >
                  Stop
                </button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 px-2 pb-2">
              <Terminal
                ref={terminalRef}
                sessionId={session?.id ?? null}
                onData={handleTerminalData}
                onResize={handleTerminalResize}
              />
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-gray-800 p-4">
          <button
            type="button"
            onClick={handleDelete}
            className="text-sm text-red-400 transition hover:text-red-300"
          >
            Delete task
          </button>
        </div>
      </aside>
    </>
  );
}
