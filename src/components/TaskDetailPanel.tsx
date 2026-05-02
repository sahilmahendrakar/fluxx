import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, Pencil, Settings, Terminal, UserCircle2, X } from 'lucide-react';
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
import type { ProjectMember } from '../renderer/projects/members';
import {
  getBlockingTasks,
  isTaskBlocked,
  validateBlockedByTaskIds,
} from '../taskDependencies';
import { projectLabelCatalog } from '../taskLabels';
import AgentModelPicker from './AgentModelPicker';
import { AGENT_CHIP_STYLES } from './AgentBadge';
import { getSessionAttachShared } from '../terminal/warmAttach';
import {
  INTERACTIVE_MIRROR_TERMINAL_VIEW_POLICY,
  terminalShouldAutoFit,
  terminalShouldForwardInput,
} from '../terminal/terminalGeometryPolicy';
import { useTerminalPtyStream } from '../terminal/useTerminalPtyStream';
import TerminalComponent, { type TerminalHandle } from './Terminal';
import { TaskLabelsField } from './TaskLabelsField';
import { ProjectMemberAvatar } from './ProjectMemberAvatar';
import { OpenInWorkspaceButton } from './OpenInWorkspaceButton';

/** Prose for markdown description read mode (aligned with PlanningDocsView, panel density). */
const MD_READ_CLASS = [
  'min-w-0 text-[13px] leading-relaxed text-zinc-300',
  '[&_a]:text-sky-400 [&_a]:underline [&_a]:decoration-sky-400/40 [&_a]:underline-offset-2 hover:[&_a]:text-sky-300',
  '[&_h1]:mb-2 [&_h1]:mt-0 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-zinc-100',
  '[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-medium [&_h2]:text-zinc-100 first:[&_h2]:mt-0',
  '[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-[14px] [&_h3]:font-medium [&_h3]:text-zinc-200',
  '[&_p]:my-2.5 [&_p]:text-zinc-300 first:[&_p]:mt-0 last:[&_p]:mb-0',
  '[&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5',
  '[&_blockquote]:my-2.5 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-600 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-400',
  '[&_code]:rounded [&_code]:bg-zinc-800/80 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-emerald-200/90',
  '[&_pre]:my-2.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-white/[0.08] [&_pre]:bg-[#0a0a0c] [&_pre]:p-2.5',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px] [&_pre_code]:text-zinc-300',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse text-[12px]',
  '[&_th]:border [&_th]:border-white/[0.08] [&_th]:bg-white/[0.04] [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium [&_th]:text-zinc-200',
  '[&_td]:border [&_td]:border-white/[0.06] [&_td]:px-2 [&_td]:py-1',
  '[&_hr]:my-4 [&_hr]:border-white/[0.08]',
  '[&_strong]:font-semibold [&_strong]:text-zinc-100',
].join(' ');

interface TaskDetailPanelProps {
  task: Task | null;
  /** Full board snapshot for dependencies and session start (same `projectId`). */
  projectTasks: Task[];
  /** True while main is creating the session (worktree + spawn), even if this panel was not open for `starting`. */
  taskSessionStartPending?: boolean;
  onSelectTask: (id: string) => void;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
  /** Present when a teammate (not the current user) is running an agent on this task. */
  remoteRunner?: { uid: string; displayName?: string; photoURL?: string } | null;
  onOpenSessionTab: (session: Session) => void;
  onArchiveSession: (sessionId: string) => void;
  /** When set (and task is not done), "Mark as done" is enabled. Omitted when blocked — use `markAsDoneBlocked`. */
  onMarkAsDone?: () => void;
  /** True when dependencies block finishing; shows a disabled Mark as done control. */
  markAsDoneBlocked?: boolean;
  /** Project “auto-start when unblocked” (from local config / cloud binding). */
  autoStartWhenUnblockedProject?: boolean;
  /** Cloud-only: list of project members for the Assignee field. Omit for local projects. */
  projectMembers?: ProjectMember[];
  /**
   * Cloud projects only: signed-in user uid. When starting a session, if the task
   * has no assignee yet, `assigneeId` is set to this value alongside in-progress.
   */
  implicitSessionAssigneeUid?: string | null;
}

const TASK_DETAIL_WIDTH_KEY = 'flux.taskDetailPanelWidth';
const DEFAULT_DETAIL_WIDTH = 480;
const MIN_DETAIL_WIDTH = 280;
const MIN_BOARD_REMAINING_PX = 200;

/** Drag handle between the scrollable form and the session/terminal (matches layout gap). */
const TASK_FORM_SPLIT_HANDLE_PX = 6;
const MIN_SESSION_PANE_PX = 192; // 12rem — keep terminal area usable
const MIN_TASK_FORM_PANE_PX = 160; // min height for the title/form scroller
const DEFAULT_SESSION_PANE_PX = 224; // default terminal allocation (14rem at 1rem=16px)

function clampSessionPaneHeight(h: number, containerHeightPx: number): number {
  if (containerHeightPx <= 0) {
    return Math.round(h);
  }
  const maxH = Math.max(
    0,
    containerHeightPx - MIN_TASK_FORM_PANE_PX - TASK_FORM_SPLIT_HANDLE_PX,
  );
  const minH = Math.min(MIN_SESSION_PANE_PX, maxH);
  return Math.max(minH, Math.min(maxH, Math.round(h)));
}

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

const STATUS_CHIP: Record<TaskStatus, string> = {
  backlog: 'bg-white/[0.04] text-zinc-400 ring-1 ring-inset ring-white/[0.06]',
  'in-progress': 'bg-emerald-500/[0.12] text-emerald-200/95 ring-1 ring-inset ring-emerald-500/15',
  'needs-input': 'bg-amber-500/[0.12] text-amber-200/90 ring-1 ring-inset ring-amber-500/18',
  done: 'bg-white/[0.03] text-zinc-500 ring-1 ring-inset ring-white/[0.05]',
};

function formatCreatedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function projectMemberLabel(m: ProjectMember): string {
  return m.displayName || m.email || m.uid;
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
  taskSessionStartPending = false,
  onSelectTask,
  onClose,
  onUpdate,
  onDelete,
  remoteRunner,
  onOpenSessionTab,
  onArchiveSession,
  onMarkAsDone,
  markAsDoneBlocked = false,
  autoStartWhenUnblockedProject = false,
  projectMembers,
  implicitSessionAssigneeUid,
}: TaskDetailPanelProps) {
  const asideRef = useRef<HTMLElement>(null);
  const [detailWidth, setDetailWidth] = useState(DEFAULT_DETAIL_WIDTH);
  const titleArea = useAutosizeTextArea(task?.title ?? '');
  const descriptionArea = useAutosizeTextArea(task?.description ?? '', 120);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  /** Attach + snapshot applied; terminal may still be blank until first PTY output. */
  const [sessionStreamReady, setSessionStreamReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const [depSearch, setDepSearch] = useState('');
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const terminalRef = useRef<TerminalHandle | null>(null);
  const taskFormSplitRef = useRef<HTMLDivElement>(null);
  const [sessionPaneHeightPx, setSessionPaneHeightPx] = useState(
    DEFAULT_SESSION_PANE_PX,
  );

  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const agentSettingsWrapRef = useRef<HTMLDivElement>(null);
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const assigneeMenuWrapRef = useRef<HTMLDivElement>(null);
  /** Local path for “Open in” (running session, stopped session, or leftover worktree on disk). */
  const [resolvedWorktreePath, setResolvedWorktreePath] = useState<string | null>(null);

  const labelCatalog = useMemo(
    () => projectLabelCatalog(projectTasks),
    [projectTasks],
  );

  const selectedAssigneeMember = useMemo(() => {
    if (!task?.assigneeId || projectMembers === undefined) return null;
    return projectMembers.find((m) => m.uid === task.assigneeId) ?? null;
  }, [task?.assigneeId, projectMembers]);

  useEffect(() => {
    setAgentSettingsOpen(false);
    setAssigneeMenuOpen(false);
    setDependencyError(null);
    setDepSearch('');
    setDescriptionEditing(false);
  }, [task?.id]);

  useEffect(() => {
    if (!task) {
      setResolvedWorktreePath(null);
      return;
    }
    let cancelled = false;
    const refreshWorktreePath = () => {
      void window.electronAPI.workspace.resolveTaskWorktree(task.id).then((p) => {
        if (!cancelled) setResolvedWorktreePath(p);
      });
    };
    refreshWorktreePath();
    const unsubExit = window.electronAPI.sessions.onExit((ex) => {
      if (ex.taskId === task.id) refreshWorktreePath();
    });
    const unsubTasks = window.electronAPI.tasks.onChanged(refreshWorktreePath);
    return () => {
      cancelled = true;
      unsubExit();
      unsubTasks();
    };
  }, [task?.id, session?.id, session?.worktreePath, taskSessionStartPending]);

  useEffect(() => {
    if (!task) return;
    return window.electronAPI.sessions.onTaskStartProgress((p) => {
      if (p.taskId !== task.id || p.phase !== 'settled') return;
      const { outcome: o } = p;
      if ('error' in o) {
        if (o.error === 'TASK_BLOCKED') {
          setSessionError(
            o.message ?? 'This task is blocked by incomplete work.',
          );
        } else {
          setSessionError(o.message ?? o.error);
        }
      } else {
        setSessionError(null);
        setSession(o);
      }
    });
  }, [task?.id]);

  useEffect(() => {
    setSessionStreamReady(false);
  }, [session?.id]);

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

  useEffect(() => {
    if (!assigneeMenuOpen) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const root = assigneeMenuWrapRef.current;
      if (root && !root.contains(e.target as Node)) {
        setAssigneeMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [assigneeMenuOpen]);

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

  const getTaskFormSplitHeight = useCallback(() => {
    return taskFormSplitRef.current?.getBoundingClientRect().height ?? 0;
  }, []);

  useLayoutEffect(() => {
    const el = taskFormSplitRef.current;
    if (!el) return;
    const sync = () => {
      setSessionPaneHeightPx((prev) => clampSessionPaneHeight(prev, el.getBoundingClientRect().height));
    };
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(sync);
    });
    ro.observe(el);
    sync();
    return () => ro.disconnect();
  }, [task?.id]);

  useLayoutEffect(() => {
    terminalRef.current?.fit();
  }, [sessionPaneHeightPx, session?.id, task?.id]);

  const handleSessionSplitPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget;
      const startY = e.clientY;
      const startH = sessionPaneHeightPx;
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: globalThis.PointerEvent) => {
        const next = startH - (ev.clientY - startY);
        setSessionPaneHeightPx(
          clampSessionPaneHeight(next, getTaskFormSplitHeight()),
        );
      };

      const onUp = (ev: globalThis.PointerEvent) => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        setSessionPaneHeightPx((prev) =>
          clampSessionPaneHeight(prev, getTaskFormSplitHeight()),
        );
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [getTaskFormSplitHeight, sessionPaneHeightPx],
  );

  const handleSessionSplitDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setSessionPaneHeightPx(
        clampSessionPaneHeight(
          DEFAULT_SESSION_PANE_PX,
          getTaskFormSplitHeight(),
        ),
      );
    },
    [getTaskFormSplitHeight],
  );

  const onSessionSplitKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown' &&
        e.key !== 'Home' &&
        e.key !== 'End'
      ) {
        return;
      }
      e.preventDefault();
      const H = getTaskFormSplitHeight();
      if (H <= 0) return;
      const maxH = Math.max(
        0,
        H - MIN_TASK_FORM_PANE_PX - TASK_FORM_SPLIT_HANDLE_PX,
      );
      const minH = Math.min(MIN_SESSION_PANE_PX, maxH);
      const step = e.shiftKey ? 40 : 10;
      setSessionPaneHeightPx((prev) => {
        if (e.key === 'Home') {
          return clampSessionPaneHeight(minH, H);
        }
        if (e.key === 'End') {
          return clampSessionPaneHeight(maxH, H);
        }
        if (e.key === 'ArrowUp') {
          return clampSessionPaneHeight(prev + step, H);
        }
        if (e.key === 'ArrowDown') {
          return clampSessionPaneHeight(prev - step, H);
        }
        return prev;
      });
    },
    [getTaskFormSplitHeight],
  );

  const lastSessionFetchTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!task) {
      lastSessionFetchTaskIdRef.current = null;
      return;
    }
    setSessionError(null);
    const idChanged = lastSessionFetchTaskIdRef.current !== task.id;
    if (idChanged) {
      setSession(null);
      lastSessionFetchTaskIdRef.current = task.id;
    }
    let cancelled = false;
    void window.electronAPI.sessions.get(task.id).then((existingSession) => {
      if (cancelled) return;
      if (existingSession && existingSession.status === 'running') {
        setSession(existingSession);
      } else {
        setSession(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [task?.id, task?.status]);

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

  const sessionId = session?.id;
  const sessionReadyForPty = Boolean(sessionId && session?.status === 'running');
  useTerminalPtyStream({
    terminalRef,
    id: sessionId ?? '',
    enabled: sessionReadyForPty,
    viewPolicy: INTERACTIVE_MIRROR_TERMINAL_VIEW_POLICY,
    getAttach: () => {
      const id = sessionId;
      if (!id) {
        return Promise.resolve(null);
      }
      return getSessionAttachShared(id, async () => {
        try {
          return await window.electronAPI.sessions.attach(id);
        } catch (err) {
          console.error('[TaskDetailPanel] attach failed', err);
          return null;
        }
      });
    },
    onStreamData: (id, cb) => window.electronAPI.sessions.onData(id, cb),
    onAttachComplete: () => setSessionStreamReady(true),
  });

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
      const statusPatch: Partial<Task> = { status: 'in-progress' };
      if (implicitSessionAssigneeUid && !task.assigneeId) {
        statusPatch.assigneeId = implicitSessionAssigneeUid;
      }
      onUpdate(task.id, statusPatch);
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
  const startInFlight = sessionLoading || taskSessionStartPending;
  const showSessionStarting =
    startInFlight || (sessionRunning && !sessionStreamReady);
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
  const descriptionRaw = task.description ?? '';
  const hasDescription = descriptionRaw.trim().length > 0;

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

  const startButtonLabel = startInFlight
    ? 'Starting…'
    : sessionError
      ? 'Retry'
      : 'Start session';
  const startBtnPrimary =
    'rounded-lg bg-emerald-500/90 px-4 py-2 text-[13px] font-medium text-emerald-950 shadow-sm transition hover:bg-emerald-400/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0b] disabled:cursor-not-allowed';
  const startBtnIdle = `${startBtnPrimary} disabled:bg-zinc-800/80 disabled:text-zinc-500 disabled:shadow-none`;
  const startBtnError =
    'rounded-lg border border-red-500/35 bg-red-500/[0.12] px-4 py-2 text-[13px] font-medium text-red-200/90 transition hover:bg-red-500/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40';
  const startBtnLoading =
    'cursor-wait rounded-lg bg-zinc-800/90 px-4 py-2 text-[13px] font-medium text-zinc-500';
  const markDoneBtn =
    'rounded-lg bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-zinc-100 ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25';
  const markDoneBtnDisabled =
    'cursor-not-allowed rounded-lg bg-zinc-800/50 px-4 py-2 text-[13px] font-medium text-zinc-500 ring-1 ring-inset ring-white/[0.06]';

  const propertySelectClass =
    'w-full min-w-0 max-w-full cursor-pointer appearance-none rounded-lg border-0 bg-white/[0.04] py-1.5 pl-2.5 pr-8 text-[12px] font-medium text-zinc-200 ring-1 ring-inset ring-white/[0.06] outline-none transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/20';
  const assigneeTriggerClass =
    'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border-0 bg-white/[0.04] py-1.5 pl-2.5 pr-2 text-left text-[12px] font-medium text-zinc-200 ring-1 ring-inset ring-white/[0.06] outline-none transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/20';

  /** Any local session (running or after exit) — keep embedded terminal for buffer continuity. */
  const hasLocalSession = Boolean(session?.id);
  const sessionIdleAfterRun = hasLocalSession && !sessionRunning;

  const showMarkAsDone = task.status !== 'done';
  const markDoneDisabled = showMarkAsDone && (markAsDoneBlocked || !onMarkAsDone);

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
        className="absolute inset-y-0 right-0 z-20 flex min-w-0 flex-col border-l border-white/[0.04] bg-[#0a0a0b] shadow-[0_0_0_1px_rgba(255,255,255,0.04),-12px_0_40px_rgba(0,0,0,0.45)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize task details"
          title="Drag to resize. Double-click to reset."
          className="absolute bottom-0 left-0 top-0 z-30 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-white/[0.08] before:content-[''] hover:before:bg-white/[0.2] focus-visible:ring-1 focus-visible:ring-white/20"
          onPointerDown={handleResizePointerDown}
          onDoubleClick={handleResizeDoubleClick}
        />

        {/* Top bar: metadata + primary CTA + close */}
        <header className="flex shrink-0 items-start gap-3 border-b border-white/[0.05] px-5 py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-md px-2.5 py-0.5 text-xs font-medium ${STATUS_CHIP[task.status]}`}
              >
                {statusLabel}
              </span>
              {task.createdAt ? (
                <span className="text-xs text-zinc-500">Created {formatCreatedLabel(task.createdAt)}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {showMarkAsDone ? (
                <button
                  type="button"
                  onClick={() => onMarkAsDone?.()}
                  disabled={markDoneDisabled}
                  title={
                    markAsDoneBlocked
                      ? 'Finish blocking tasks before marking this task done'
                      : undefined
                  }
                  className={markDoneDisabled ? markDoneBtnDisabled : markDoneBtn}
                >
                  Mark as done
                </button>
              ) : null}
              <OpenInWorkspaceButton worktreePath={resolvedWorktreePath} size="md" />
              {!sessionRunning ? (
                <button
                  type="button"
                  onClick={handleStartSession}
                  disabled={startInFlight || blocked}
                  title={blocked ? 'Blocked by incomplete dependencies' : undefined}
                  className={
                    startInFlight
                      ? startBtnLoading
                      : sessionError
                        ? startBtnError
                        : blocked
                          ? 'cursor-not-allowed rounded-lg bg-zinc-800/50 px-4 py-2 text-[13px] font-medium text-zinc-500 ring-1 ring-inset ring-white/[0.06]'
                          : startBtnIdle
                  }
                >
                  {blocked ? 'Blocked' : startButtonLabel}
                </button>
              ) : null}
              {sessionError && !sessionRunning ? (
                <p className="min-w-0 text-xs leading-snug text-red-300/90">{sessionError}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div ref={taskFormSplitRef} className="flex min-h-0 flex-1 flex-col">
          <div
            className="min-h-0 min-w-0 flex-1 overflow-y-auto"
            style={{ minHeight: MIN_TASK_FORM_PANE_PX }}
          >
            <div className="space-y-6 px-5 py-5">
              <textarea
                id="task-detail-title"
                ref={titleArea.ref}
                value={task.title}
                rows={1}
                onChange={(e) => {
                  onUpdate(task.id, { title: e.target.value });
                  titleArea.resize();
                }}
                className="w-full resize-none bg-transparent text-2xl font-semibold leading-tight tracking-tight text-zinc-50 placeholder:text-zinc-600 outline-none focus:outline-none focus-visible:ring-0"
                placeholder="Task title"
              />

              <TaskLabelsField
                idPrefix={`task-${task.id}`}
                labels={task.labels ?? []}
                labelCatalog={labelCatalog}
                variant="panel"
                onLabelsChange={(next) => onUpdate(task.id, { labels: next })}
              />

              {/* Properties: compact row */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs text-zinc-500">Agent & model</p>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <select
                      value={task.agent}
                      onChange={(e) => {
                        const next = e.target.value as Agent;
                        const patch: Partial<Task> = { agent: next };
                        if (next !== task.agent) {
                          patch.agentYolo = false;
                          patch.agentModel = next === 'cursor' ? DEFAULT_CURSOR_AGENT_MODEL : '';
                        }
                        onUpdate(task.id, patch);
                      }}
                      className={`max-w-full shrink-0 ${propertySelectClass} ${AGENT_CHIP_STYLES[task.agent]}`}
                      style={{ colorScheme: 'dark' } as CSSProperties}
                      aria-label="Agent provider"
                    >
                      {AGENTS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    {task.agent === 'cursor' ? (
                      <div className="min-w-0 max-w-[200px] flex-1 sm:max-w-xs">
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
                      </div>
                    ) : task.agent === 'claude-code' ? (
                      <div className="min-w-0 max-w-[200px] flex-1 sm:max-w-xs">
                        <AgentModelPicker
                          kind="claude-code"
                          modelId={claudeCodeExplicitModel(task) ?? ''}
                          onModelIdChange={(id) => onUpdate(task.id, { agentModel: id.trim() })}
                          aria-label="Claude Code model"
                        />
                      </div>
                    ) : (
                      <span
                        className="text-xs text-zinc-500"
                        title="Model selection is not wired for Codex in this version."
                      >
                        Default model
                      </span>
                    )}
                    <div ref={agentSettingsWrapRef} className="relative shrink-0">
                      <button
                        type="button"
                        aria-label="Agent spawn settings"
                        aria-expanded={agentSettingsOpen}
                        onClick={() => setAgentSettingsOpen((o) => !o)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                      >
                        <Settings className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                      </button>
                      {agentSettingsOpen ? (
                        <div
                          className="absolute right-0 z-40 mt-1.5 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-white/[0.08] bg-[#111113] p-3 text-[12px] shadow-xl shadow-black/50"
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
                                  Matches Cursor Agent <code className="text-zinc-400">--yolo</code> /{' '}
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
                                <span className="font-medium text-zinc-100">Skip permission checks</span>
                                <span className="mt-1 block text-[11px] text-zinc-500">
                                  Passes <code className="text-zinc-400">--dangerously-skip-permissions</code> to
                                  Claude Code. Anthropic recommends this only for trusted sandboxes.
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
                </div>
                <div className="w-full min-w-0 sm:w-44 sm:shrink-0">
                  <label htmlFor="task-status-select" className="mb-1.5 block text-xs text-zinc-500">
                    Status
                  </label>
                  <select
                    id="task-status-select"
                    value={task.status}
                    onChange={(e) => onUpdate(task.id, { status: e.target.value as TaskStatus })}
                    className={propertySelectClass}
                    style={{ colorScheme: 'dark' } as CSSProperties}
                    aria-label="Change status"
                  >
                    {COLUMNS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {projectMembers !== undefined ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <p className="shrink-0 text-xs text-zinc-500">Assignee</p>
                  <div ref={assigneeMenuWrapRef} className="relative min-w-0 sm:max-w-[min(18rem,100%)] sm:flex-1">
                    <button
                      type="button"
                      id="task-assignee-trigger"
                      onClick={() => setAssigneeMenuOpen((o) => !o)}
                      aria-haspopup="listbox"
                      aria-expanded={assigneeMenuOpen}
                      aria-controls="task-assignee-listbox"
                      className={assigneeTriggerClass}
                    >
                      {task.assigneeId && selectedAssigneeMember ? (
                        <>
                          <ProjectMemberAvatar member={selectedAssigneeMember} size="sm" />
                          <span className="min-w-0 flex-1 truncate">
                            {projectMemberLabel(selectedAssigneeMember)}
                          </span>
                        </>
                      ) : task.assigneeId ? (
                        <>
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-500/[0.15] text-[10px] font-medium text-zinc-400">
                            ?
                          </div>
                          <span className="min-w-0 flex-1 truncate text-zinc-400">
                            Unknown member
                          </span>
                        </>
                      ) : (
                        <>
                          <UserCircle2
                            className="h-5 w-5 shrink-0 text-zinc-500"
                            strokeWidth={1.5}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate text-zinc-400">
                            Unassigned
                          </span>
                        </>
                      )}
                      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" strokeWidth={2} aria-hidden />
                    </button>
                    {assigneeMenuOpen ? (
                      <div
                        id="task-assignee-listbox"
                        role="listbox"
                        aria-labelledby="task-assignee-trigger"
                        className="absolute left-0 right-0 z-40 mt-1 max-h-56 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#111113] py-1 shadow-xl shadow-black/50"
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={!task.assigneeId}
                          className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] text-zinc-200 hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none"
                          onClick={() => {
                            onUpdate(task.id, { assigneeId: null });
                            setAssigneeMenuOpen(false);
                          }}
                        >
                          <UserCircle2
                            className="h-5 w-5 shrink-0 text-zinc-500"
                            strokeWidth={1.5}
                            aria-hidden
                          />
                          <span className="truncate text-zinc-400">Unassigned</span>
                        </button>
                        {projectMembers.map((m) => {
                          const selected = task.assigneeId === m.uid;
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
                                onUpdate(task.id, { assigneeId: m.uid });
                                setAssigneeMenuOpen(false);
                              }}
                            >
                              <ProjectMemberAvatar member={m} size="sm" />
                              <span className="min-w-0 flex-1 truncate">{projectMemberLabel(m)}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Description: read-first, edit on demand */}
            <section
              className="border-t border-white/[0.04] bg-white/[0.02] px-5 py-5"
              aria-label="Description"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-zinc-300">Description</h2>
                {!descriptionEditing ? (
                  <button
                    type="button"
                    onClick={() => setDescriptionEditing(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    {hasDescription ? 'Edit' : 'Add details'}
                  </button>
                ) : null}
              </div>
              {descriptionEditing ? (
                <textarea
                  id="task-detail-description"
                  ref={descriptionArea.ref}
                  value={descriptionRaw}
                  onChange={(e) => {
                    onUpdate(task.id, { description: e.target.value });
                    descriptionArea.resize();
                  }}
                  onBlur={() => setDescriptionEditing(false)}
                  autoFocus
                  rows={4}
                  placeholder="Write a plan, acceptance criteria, or notes — Markdown is supported."
                  className="min-h-[8rem] w-full resize-y rounded-xl bg-[#0c0c0e] px-3.5 py-3.5 text-[13px] leading-[1.65] text-zinc-200 ring-1 ring-inset ring-white/[0.06] outline-none placeholder:text-zinc-600 focus-visible:ring-2 focus-visible:ring-white/20"
                />
              ) : (
                <div className="group relative min-h-[3rem]">
                  {hasDescription ? (
                    <article className={MD_READ_CLASS}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{descriptionRaw}</ReactMarkdown>
                    </article>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDescriptionEditing(true)}
                      className="w-full rounded-xl border border-dashed border-white/[0.1] bg-transparent py-8 text-left text-sm text-zinc-500 transition hover:border-white/[0.14] hover:bg-white/[0.02] hover:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                    >
                      No description yet. Click to add plan, criteria, or notes.
                    </button>
                  )}
                </div>
              )}
            </section>

            <div className="space-y-4 px-5 py-5">
              {(blockingTasks.length > 0 || staleMissingIds.length > 0) && (
                <div
                  className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3.5 py-2.5 text-sm leading-relaxed text-amber-100/90"
                  role="status"
                >
                  {blockingTasks.length > 0 ? (
                    <p>
                      <span className="font-medium text-amber-200/95">Waiting on other work</span>
                      <span className="text-amber-100/85">
                        {' '}
                        — complete {blockingTasks.length === 1 ? 'this task' : 'these tasks'} first:{' '}
                        {blockingTasks.map((b) => b.title || '(Untitled)').join(', ')}
                      </span>
                    </p>
                  ) : null}
                  {staleMissingIds.length > 0 ? (
                    <p
                      className={`text-xs text-amber-200/75 ${blockingTasks.length > 0 ? 'mt-1.5' : ''}`}
                    >
                      {staleMissingIds.length} reference{staleMissingIds.length === 1 ? '' : 's'} missing
                      from the board — remove {staleMissingIds.length === 1 ? 'it' : 'them'} below.
                    </p>
                  ) : null}
                </div>
              )}

              <section className="space-y-2" aria-label="Dependencies">
                <h2 className="text-sm font-medium text-zinc-300">Blockers & dependencies</h2>
                <p className="text-xs leading-relaxed text-zinc-500">
                  This task stays blocked until every listed dependency is done. Missing task ids are ignored
                  for blocking logic.
                </p>
                {task.status !== 'done' && (task.blockedByTaskIds ?? []).length > 0 ? (
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={task.autoStartOnUnblock === true}
                      onChange={(e) =>
                        onUpdate(task.id, { autoStartOnUnblock: e.target.checked })
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/[0.2] bg-[#09090b]"
                    />
                    <span className="min-w-0">
                      <span className="text-[13px] font-medium text-zinc-200">
                        Auto-start when unblocked
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                        Start a session when the last dependency is completed
                        {autoStartWhenUnblockedProject
                          ? ' (this project can also auto-start from settings).'
                          : ' (or enable the project default in settings).'}
                      </span>
                    </span>
                  </label>
                ) : null}
                {(task.blockedByTaskIds ?? []).length === 0 ? (
                  <p className="text-sm text-zinc-600">No dependencies — this task is not waiting on other work.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {(task.blockedByTaskIds ?? []).map((bid) => {
                      const other = taskById.get(bid);
                      if (other) {
                        const stLabel =
                          COLUMNS.find((c) => c.id === other.status)?.label ?? other.status;
                        return (
                          <li
                            key={bid}
                            className="flex min-h-[2.75rem] items-stretch gap-0 overflow-hidden rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/[0.06] transition hover:bg-white/[0.04]"
                          >
                            <button
                              type="button"
                              onClick={() => onSelectTask(bid)}
                              className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm text-zinc-200 transition hover:text-white"
                            >
                              <span className="line-clamp-2 font-medium">{other.title || '(Untitled)'}</span>
                              <span className="ml-2 inline-block align-middle text-xs text-zinc-500">Open →</span>
                            </button>
                            <div className="flex shrink-0 items-center gap-1 border-l border-white/[0.05] pl-1 pr-1.5">
                              <span
                                className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[other.status]}`}
                              >
                                {stLabel}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeBlocker(bid)}
                                className="rounded-md px-2 py-1 text-xs text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-200"
                                aria-label={`Remove dependency on ${other.title || bid}`}
                              >
                                Remove
                              </button>
                            </div>
                          </li>
                        );
                      }
                      return (
                        <li
                          key={bid}
                          className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2 ring-1 ring-inset ring-amber-500/15"
                        >
                          <span className="min-w-0 text-sm text-zinc-500">
                            Missing on board <code className="text-zinc-400">{bid}</code>
                          </span>
                          <button
                            type="button"
                            onClick={() => removeBlocker(bid)}
                            className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-200"
                          >
                            Remove
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="pt-1">
                  <input
                    type="search"
                    value={depSearch}
                    onChange={(e) => setDepSearch(e.target.value)}
                    placeholder="Add dependency by search…"
                    className="w-full rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-zinc-200 ring-1 ring-inset ring-white/[0.06] outline-none transition placeholder:text-zinc-600 focus-visible:ring-2 focus-visible:ring-white/20"
                    aria-label="Search tasks to add as dependencies"
                  />
                </div>
                {dependencyError ? (
                  <p className="text-xs text-red-300/90" role="alert">
                    {dependencyError}
                  </p>
                ) : null}
                {pickCandidates.length > 0 ? (
                  <ul
                    className="max-h-40 overflow-y-auto rounded-lg bg-[#0c0c0e] py-1 ring-1 ring-inset ring-white/[0.06]"
                    role="listbox"
                    aria-label="Tasks matching your search"
                  >
                    {pickCandidates.slice(0, 50).map((t) => {
                      const stLabel = COLUMNS.find((c) => c.id === t.status)?.label ?? t.status;
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => addBlocker(t.id)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-zinc-200 transition hover:bg-white/[0.05]"
                          >
                            <span className="min-w-0 truncate">{t.title || '(Untitled)'}</span>
                            <span className="shrink-0 text-xs text-zinc-500">{stLabel}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : depSearch.trim() ? (
                  <p className="text-xs text-zinc-600">No matching tasks.</p>
                ) : null}
              </section>
            </div>
          </div>

          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize between task details and session output"
            title="Drag to resize session. Double-click to reset."
            tabIndex={0}
            className="relative z-10 h-1.5 w-full shrink-0 cursor-row-resize touch-none border-t border-white/[0.05] bg-[#0a0a0b] outline-none transition before:pointer-events-none before:absolute before:left-2 before:right-2 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-white/[0.12] before:content-[''] hover:before:bg-white/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
            onPointerDown={handleSessionSplitPointerDown}
            onDoubleClick={handleSessionSplitDoubleClick}
            onKeyDown={onSessionSplitKeyDown}
          />

          {/* Session: secondary when idle; compact chrome when live */}
          <div
            className="flex min-w-0 min-h-0 shrink-0 flex-col overflow-hidden bg-[#080809]"
            style={{ height: sessionPaneHeightPx }}
          >
            {sessionRunning && session ? (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.04] px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400/90" />
                  <span className="truncate text-xs font-medium text-zinc-400">Session running</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={handleOpenInTab}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  >
                    Open in tab
                  </button>
                  <button
                    type="button"
                    onClick={handleArchiveFromPanel}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/30"
                    title="Archive — kill agent and terminals, keep worktree"
                  >
                    Archive
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                  <Terminal className="h-3.5 w-3.5 opacity-70" strokeWidth={2} aria-hidden />
                  {sessionIdleAfterRun ? 'Session output (ended)' : 'Output'}
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
              {remoteRunner && !session ? (
                <div className="flex h-full min-h-[7rem] flex-col items-center justify-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-6 text-center">
                  <div className="flex items-center gap-2.5 text-sm text-zinc-200">
                    <ProjectMemberAvatar
                      member={{
                        uid: remoteRunner.uid,
                        displayName: remoteRunner.displayName,
                        photoURL: remoteRunner.photoURL,
                      }}
                      size="sm"
                    />
                    <span className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
                    <span className="min-w-0 font-medium">
                      {remoteRunner.displayName ?? 'A teammate'} is running an agent
                    </span>
                  </div>
                  <p className="max-w-[18rem] text-xs leading-relaxed text-zinc-500">
                    Terminal output stays on their machine for now. You will see status updates here as
                    they work.
                  </p>
                </div>
              ) : !hasLocalSession ? (
                <div className="relative flex h-full min-h-[6.5rem] flex-col">
                  {showSessionStarting ? (
                    <div
                      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-[#0a0a0b]/95 text-[13px] text-zinc-400"
                      aria-live="polite"
                      aria-busy="true"
                    >
                      <span
                        className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300"
                        aria-hidden
                      />
                      <span className="font-medium text-zinc-300">Starting…</span>
                    </div>
                  ) : null}
                  {blocked && !sessionRunning && !session ? (
                    <p
                      className="mb-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-100/90"
                      role="status"
                    >
                      Start session is off until blockers are cleared.
                    </p>
                  ) : null}
                  <div className="flex min-h-[5rem] flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-5 text-center">
                    <p className="text-sm text-zinc-500">No live session in this panel</p>
                    <p className="max-w-sm text-xs leading-relaxed text-zinc-600">
                      {blocked
                        ? 'Unblock the task, then use Start session above. Output streams here and in a workspace tab.'
                        : 'When you start a session, the agent’s terminal streams here. Open in a tab for the full view.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="relative h-full min-h-[120px]">
                  {showSessionStarting ? (
                    <div
                      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md border border-white/[0.06] bg-[#0a0a0c]/95 text-[13px] text-zinc-400"
                      aria-live="polite"
                      aria-busy="true"
                    >
                      <span
                        className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300"
                        aria-hidden
                      />
                      <span className="font-medium text-zinc-300">Starting…</span>
                    </div>
                  ) : null}
                  <TerminalComponent
                    ref={terminalRef}
                    sessionId={session?.id ?? null}
                    onData={
                      terminalShouldForwardInput(INTERACTIVE_MIRROR_TERMINAL_VIEW_POLICY)
                        ? handleTerminalData
                        : undefined
                    }
                    autoFit={terminalShouldAutoFit(INTERACTIVE_MIRROR_TERMINAL_VIEW_POLICY)}
                    hideCursor
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-white/[0.05] px-5 py-3">
          <button
            type="button"
            onClick={handleDelete}
            className="text-sm text-zinc-500 transition hover:text-red-400/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0b] rounded"
          >
            Delete task
          </button>
        </div>
      </aside>
    </>
  );
}
