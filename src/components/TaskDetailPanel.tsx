import {
  createElement,
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
import { MarkdownContent, markdownProseClassName } from './markdownContent';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  Ban,
  CirclePlay,
  FileText,
  Pencil,
  Settings,
  ShieldCheck,
  Terminal,
  UserCircle2,
  X,
} from 'lucide-react';
import {
  Task,
  TaskStatus,
  COLUMNS,
  boardColumns,
  TASK_AGENT_SELECT_OPTIONS,
  Agent,
  Session,
  DEFAULT_CURSOR_AGENT_MODEL,
  claudeCodeExplicitModel,
  resolvedCursorAgentModel,
  type ExecutionDeviceConfig,
  type RepoBranchDiscovery,
  type RepoConfig,
  type ResolveTaskWorktreeIpcResult,
  type SessionStartErrorCode,
  type TaskExecutionDeviceRef,
} from '../types';
import { ExecutionDevicePicker } from './ExecutionDevicePicker';
import { RemoteSshRepoBindingPanel } from './RemoteSshRepoBindingPanel';
import {
  isTaskExecutionDeviceEditable,
  sessionStartButtonLabel,
  sessionStartErrorMessage,
} from '../executionDevices/deviceUi';
import type { TaskPatch } from '../renderer/tasks/TaskProvider';
import {
  effectiveTaskRepoId,
  findRepoByIdOrPrimary,
  repoDisplayLabel,
  resolvePrimaryRepoId,
} from '../repoIdentity';
import {
  type ProjectMember,
  projectMemberDisplayLabel,
} from '../renderer/projects/members';
import { isTaskBlocked, validateBlockedByTaskIds } from '../taskDependencies';
import {
  patchAutoStartOnUnblockAfterToggle,
  whenUnblockedAutostartBoardChipEffective,
} from '../unblockAutostart';
import { projectLabelCatalog } from '../taskLabels';
import AgentModelPicker from './AgentModelPicker';
import { getSessionAttachShared } from '../terminal/warmAttach';
import {
  INTERACTIVE_MIRROR_TERMINAL_VIEW_POLICY,
  terminalShouldAutoFit,
} from '../terminal/terminalGeometryPolicy';
import { useTerminalPtyStream } from '../terminal/useTerminalPtyStream';
import {
  TerminalAttachLoading,
  TerminalResizeHandle,
} from '@/components/terminal/TerminalChrome';
import TerminalComponent, { type TerminalHandle } from './Terminal';
import { TaskLabelsField } from './TaskLabelsField';
import { ProjectMemberAvatar } from './ProjectMemberAvatar';
import { OpenInWorkspaceButton } from './OpenInWorkspaceButton';
import { GithubPrIconButton } from './GithubPrIconButton';
import TaskSourceBranchPicker from './TaskSourceBranchPicker';
import ConfirmDialog from './ConfirmDialog';
import { AGENT_SPAWN_AGENT_SELECT_CLASS } from './AgentSessionPrefsMenu';
import { TASK_STATUS_CHIP } from '../taskStatusChip';
import type { PlanningDocFileEntry } from '../planningDocs/types';
import {
  attachedPlanningDocChipPresence,
  compactPlanningDocPathLabel,
} from '../taskPlanningDocAttachments';
import { sanitizeTaskAttachedPlanningDocsInput } from '../taskAttachedPlanningDocs';
import TaskValidationSection from './validation/TaskValidationSection';
import { useTaskValidationRuns } from '../validationRuns/useTaskValidationRuns';
import { validateButtonClassNameForStatus } from '../validationRuns/validateButtonClassNames';
import { evaluateValidateActionEligibility } from '../validationRuns/validateTaskAction';
import {
  buildTaskSourceBranchPersistPatch,
  effectiveTaskSourceBranchShort,
  gitBranchShortNameLooksValid,
  planTaskSourceBranchFieldsForCreate,
  taskSourceBranchPersistIsNoOp,
} from '../taskBranches';
import {
  projectRepoActionsBlocked,
  READY_PROJECT_REPO_READINESS,
  type ProjectRepoReadiness,
} from '../projectRepoReadiness';

function taskAgentSupportsCliResume(agent: Agent | null): boolean {
  return agent === 'cursor' || agent === 'claude-code' || agent === 'codex';
}

/** Matches task card blocked chip: Ban, or CirclePlay when auto-start on unblock is on. */
function TaskBlockedSessionControlIcon({
  willAutoStartWhenUnblocked,
}: {
  willAutoStartWhenUnblocked: boolean;
}) {
  if (willAutoStartWhenUnblocked) {
    return (
      <>
        <CirclePlay
          className="size-3.5 shrink-0 text-status-success-foreground"
          strokeWidth={2}
          aria-hidden
        />
        <span className="sr-only">Blocked — will auto-start when unblocked</span>
      </>
    );
  }
  return (
    <>
      <Ban
        className="size-3.5 shrink-0 text-status-needs-input-foreground"
        strokeWidth={2}
        aria-hidden
      />
      <span className="sr-only">Blocked</span>
    </>
  );
}

/** Prose for markdown description read mode (aligned with PlanningDocsView, panel density). */
const MD_READ_CLASS = markdownProseClassName({ density: 'panel' });

function AttachPlanningDocSelect({
  attachablePlanningDocs,
  resetKey,
  onAttach,
}: {
  attachablePlanningDocs: { relativePath: string }[];
  resetKey: string;
  onAttach: (relativePath: string) => void;
}) {
  return (
    <Select
      key={resetKey}
      onValueChange={(v) => {
        if (!v) return;
        onAttach(v);
      }}
    >
      <SelectTrigger
        className="h-8 text-xs"
        aria-label="Attach a planning document from the project list"
      >
        <SelectValue placeholder="Attach document…" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {attachablePlanningDocs.map((f) => (
            <SelectItem key={f.relativePath} value={f.relativePath} className="text-xs">
              {f.relativePath}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export interface TaskDetailPanelProps {
  task: Task | null;
  /** Full board snapshot for dependencies and session start (same `projectId`). */
  projectTasks: Task[];
  /** True while main is creating the session (worktree + spawn), even if this panel was not open for `starting`. */
  taskSessionStartPending?: boolean;
  onSelectTask: (id: string) => void;
  onClose: () => void;
  onUpdate: (id: string, patch: TaskPatch) => void;
  onDelete: (id: string, opts?: { closeDetail?: boolean }) => void;
  /** Present when a teammate (not the current user) is running an agent on this task. */
  remoteRunner?: { uid: string; displayName?: string; photoURL?: string } | null;
  onOpenSessionTab: (session: Session) => void;
  onMinimizeSession: (sessionId: string) => void;
  /** When set (and task is not done), "Mark as done" is enabled. Omitted when blocked — use `markAsDoneBlocked`. */
  onMarkAsDone?: () => void;
  /** True when dependencies block finishing; shows a disabled Mark as done control. */
  markAsDoneBlocked?: boolean;
  /** Done task with workspace not yet cleaned — same flow as board broom / session chrome. */
  onRequestCleanupTask?: () => void;
  cleanupLoading?: boolean;
  /** Project “auto-start when unblocked” (from local config / cloud binding). */
  autoStartWhenUnblockedProject?: boolean;
  /** Electron Playwright validation opt-in for this project. */
  validationEnabledProject?: boolean;
  /** When false, hides PR controls, source-branch picker, and git SSH sync (gitless). Defaults to on. */
  gitEnabledProject?: boolean;
  /** Cloud-only: list of project members for the Assignee field. Omit for local projects. */
  projectMembers?: ProjectMember[];
  /**
   * Cloud only: true when any project member has a fresh Desktop runner heartbeat
   * for this task (direct SSH is excluded). Used to confirm assignee edits.
   */
  cloudActiveRunnerSession?: boolean;
  /**
   * Cloud projects only: signed-in user uid. When starting a session, if the task
   * has no assignee yet, `assigneeId` is set to this value alongside in-progress.
   */
  implicitSessionAssigneeUid?: string | null;
  /** Open linked PR or start create flow (same as board / session chrome). */
  onTaskPrClick?: (taskId: string) => void;
  /** True while create PR is in flight for this task. */
  prLoading?: boolean;
  /** PR creation delegated to agent; click again to discover the PR. */
  prAgentAwaiting?: boolean;
  /**
   * `board` (default): right-rail overlay with resize, embedded session mirror, backdrop.
   * `sessionWorkspace`: full-area inline body for the task session workspace Details tab
   * (no overlay, no mirror terminal — use the Agent tab for output).
   */
  layout?: 'board' | 'sessionWorkspace';
  /** From `project:getRepos` when multi-repo2 is enabled. */
  projectRepos?: RepoConfig[];
  multiRepo2Enabled?: boolean;
  /** Listed planning markdown files for this workspace (same source as the Docs sidebar). */
  planningDocFiles?: PlanningDocFileEntry[];
  /** True while the host is fetching `planningDocFiles`. */
  planningDocsListLoading?: boolean;
  /** True after the host has completed at least one list fetch for this project. */
  planningDocsListFetched?: boolean;
  /** Opens the Docs tab and selects `relativePath` (unsaved-doc confirm is handled by the host). */
  onOpenPlanningDoc?: (relativePath: string) => void;
  projectRepoReadiness?: ProjectRepoReadiness;
  onOpenProjectSettings?: () => void;
  executionDevices?: ExecutionDeviceConfig[];
  cloudProject?: boolean;
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

function formatCreatedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
  onMinimizeSession,
  onMarkAsDone,
  markAsDoneBlocked = false,
  onRequestCleanupTask,
  cleanupLoading = false,
  autoStartWhenUnblockedProject = false,
  validationEnabledProject = false,
  gitEnabledProject = true,
  projectMembers,
  cloudActiveRunnerSession = false,
  implicitSessionAssigneeUid,
  onTaskPrClick,
  prLoading = false,
  prAgentAwaiting = false,
  layout = 'board',
  projectRepos,
  multiRepo2Enabled = false,
  planningDocFiles = [],
  planningDocsListLoading = false,
  planningDocsListFetched = false,
  onOpenPlanningDoc,
  projectRepoReadiness = READY_PROJECT_REPO_READINESS,
  onOpenProjectSettings,
  executionDevices = [],
  cloudProject = false,
}: TaskDetailPanelProps) {
  const sessionWorkspace = layout === 'sessionWorkspace';
  const [resolvedDevice, setResolvedDevice] = useState<TaskExecutionDeviceRef | undefined>(
    task?.executionDevice,
  );
  const asideRef = useRef<HTMLElement>(null);
  const [detailWidth, setDetailWidth] = useState(DEFAULT_DETAIL_WIDTH);
  const titleArea = useAutosizeTextArea(task?.title ?? '');
  const descriptionArea = useAutosizeTextArea(task?.description ?? '', 120);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  /** Attach + snapshot applied; terminal may still be blank until first PTY output. */
  const [sessionStreamReady, setSessionStreamReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionErrorCode, setSessionErrorCode] = useState<SessionStartErrorCode | null>(null);
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const [depSearch, setDepSearch] = useState('');
  const [dependencyAddOpen, setDependencyAddOpen] = useState(false);
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [detailContentTab, setDetailContentTab] = useState<'implementation' | 'validation'>(
    'implementation',
  );
  useEffect(() => {
    if (!validationEnabledProject && detailContentTab === 'validation') {
      setDetailContentTab('implementation');
    }
  }, [validationEnabledProject, detailContentTab]);
  const terminalRef = useRef<TerminalHandle | null>(null);
  const taskFormSplitRef = useRef<HTMLDivElement>(null);
  const [sessionPaneHeightPx, setSessionPaneHeightPx] = useState(
    DEFAULT_SESSION_PANE_PX,
  );

  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const agentSettingsWrapRef = useRef<HTMLDivElement>(null);
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const [assigneeChangeConfirm, setAssigneeChangeConfirm] = useState<{
    nextAssigneeId: string | null;
  } | null>(null);
  const assigneeMenuWrapRef = useRef<HTMLDivElement>(null);
  /** Local path for “Open in” (running session, stopped session, or leftover worktree on disk). */
  const [resolvedWorktreePath, setResolvedWorktreePath] = useState<string | null>(null);
  /** When path is missing, explains repo binding vs no worktree (`workspace:resolveTaskWorktree`). */
  const [worktreeResolveDetail, setWorktreeResolveDetail] = useState<
    ResolveTaskWorktreeIpcResult['detail'] | null
  >(null);
  const [branchDiscovery, setBranchDiscovery] = useState<RepoBranchDiscovery | null>(null);
  const [branchDiscoveryLoading, setBranchDiscoveryLoading] = useState(false);
  const [branchDiscoveryError, setBranchDiscoveryError] = useState<string | null>(null);
  const [branchDraft, setBranchDraft] = useState('');
  /** Effective {@link RepoConfig.id} while editing repository (multi-repo2). */
  const [repoDraftId, setRepoDraftId] = useState('');
  const [sourceMetadataError, setSourceMetadataError] = useState<string | null>(null);
  const [anySessionForTask, setAnySessionForTask] = useState(false);

  useEffect(() => {
    setDetailContentTab('implementation');
  }, [task?.id]);

  const primaryRepoId = useMemo(
    () => resolvePrimaryRepoId(projectRepos ?? []) ?? '',
    [projectRepos],
  );
  const statusColumnOptions = useMemo(
    () => boardColumns(validationEnabledProject),
    [validationEnabledProject],
  );
  const { latestRun: validationLatestRun } = useTaskValidationRuns(task?.id);
  const repoBlockedForValidation = projectRepoActionsBlocked(projectRepoReadiness);
  const validateEligibility = useMemo(
    () =>
      task
        ? evaluateValidateActionEligibility({
            validationEnabled: validationEnabledProject,
            task,
            latestRun: validationLatestRun,
            repoBlocked: repoBlockedForValidation,
          })
        : { canValidate: false },
    [task, validationEnabledProject, validationLatestRun, repoBlockedForValidation],
  );
  const showRepoSection = Boolean(
    multiRepo2Enabled && projectRepos && projectRepos.length > 1,
  );

  const labelCatalog = useMemo(
    () => projectLabelCatalog(projectTasks),
    [projectTasks],
  );

  const planningDocPathSet = useMemo(
    () => new Set(planningDocFiles.map((f) => f.relativePath)),
    [planningDocFiles],
  );

  const attachedPlanningPaths = useMemo(() => {
    const docs = task?.attachedPlanningDocs;
    if (!docs?.length) return [];
    return docs.map((d) => d.relativePath);
  }, [task?.attachedPlanningDocs]);

  const attachablePlanningDocs = useMemo(() => {
    const attached = new Set(attachedPlanningPaths);
    return planningDocFiles.filter((f) => !attached.has(f.relativePath));
  }, [planningDocFiles, attachedPlanningPaths]);

  const selectedAssigneeMember = useMemo(() => {
    if (!task?.assigneeId || projectMembers === undefined) return null;
    return projectMembers.find((m) => m.uid === task.assigneeId) ?? null;
  }, [task?.assigneeId, projectMembers]);

  useEffect(() => {
    setAgentSettingsOpen(false);
    setAssigneeMenuOpen(false);
    setAssigneeChangeConfirm(null);
    setDependencyError(null);
    setDepSearch('');
    setDependencyAddOpen(false);
    setDescriptionEditing(false);
    setBranchDiscovery(null);
    setBranchDiscoveryError(null);
    setBranchDiscoveryLoading(false);
    setBranchDraft('');
    setRepoDraftId('');
    setSourceMetadataError(null);
    setAnySessionForTask(false);
  }, [task?.id]);

  useEffect(() => {
    if (!task) {
      setResolvedDevice(undefined);
      return;
    }
    if (task.executionDevice) {
      setResolvedDevice(task.executionDevice);
      return;
    }
    let cancelled = false;
    void window.electronAPI.tasks.resolveEffectiveExecutionDevice(task).then((ref) => {
      if (!cancelled) setResolvedDevice(ref);
    });
    return () => {
      cancelled = true;
    };
  }, [task?.id, task?.executionDevice]);

  useEffect(() => {
    if (!task || !primaryRepoId) return;
    setRepoDraftId(effectiveTaskRepoId(task, primaryRepoId));
  }, [task?.id, task?.repoId, primaryRepoId]);

  const branchSourceLocked = useMemo(() => {
    if (!task) return false;
    return Boolean(
      taskSessionStartPending ||
        resolvedWorktreePath ||
        anySessionForTask ||
        session?.id,
    );
  }, [task?.id, taskSessionStartPending, resolvedWorktreePath, anySessionForTask, session?.id]);

  const repoFieldLocked = useMemo(
    () => Boolean(task && (branchSourceLocked || task.githubPr?.url?.trim())),
    [task, branchSourceLocked],
  );

  const discoveryRepoId = useMemo(() => {
    if (!task || !primaryRepoId) return '';
    const effective = effectiveTaskRepoId(task, primaryRepoId);
    if (!showRepoSection) return effective;
    if (repoFieldLocked) return effective;
    return repoDraftId || effective;
  }, [task, primaryRepoId, showRepoSection, repoFieldLocked, repoDraftId]);

  useEffect(() => {
    if (!task || !gitEnabledProject) return;
    let cancelled = false;
    setBranchDiscoveryLoading(true);
    setBranchDiscoveryError(null);
    const arg = discoveryRepoId ? { repoId: discoveryRepoId } : undefined;
    void window.electronAPI.repo.getBranchDiscovery(arg).then((r) => {
      if (cancelled) return;
      setBranchDiscoveryLoading(false);
      if ('error' in r) {
        setBranchDiscovery(null);
        setBranchDiscoveryError(r.error);
        return;
      }
      setBranchDiscovery(r);
    });
    return () => {
      cancelled = true;
    };
  }, [task?.id, discoveryRepoId, primaryRepoId, gitEnabledProject]);

  useEffect(() => {
    if (!task || !branchDiscovery) return;
    const taskRepo = effectiveTaskRepoId(task, primaryRepoId);
    if (showRepoSection && !repoFieldLocked && repoDraftId !== taskRepo) {
      setBranchDraft(branchDiscovery.defaultBranchShort);
      return;
    }
    setBranchDraft(effectiveTaskSourceBranchShort(task, branchDiscovery.defaultBranchShort));
  }, [
    task,
    task?.id,
    task?.sourceBranch,
    task?.createSourceBranchIfMissing,
    task?.repoId,
    branchDiscovery,
    repoDraftId,
    repoFieldLocked,
    showRepoSection,
    primaryRepoId,
  ]);

  useEffect(() => {
    if (!task) {
      setAnySessionForTask(false);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void window.electronAPI.sessions.getAll().then((all) => {
        if (!cancelled) setAnySessionForTask(all.some((s) => s.taskId === task.id));
      });
    };
    refresh();
    const unsubExit = window.electronAPI.sessions.onExit(refresh);
    const unsubTasks = window.electronAPI.tasks.onChanged(refresh);
    return () => {
      cancelled = true;
      unsubExit();
      unsubTasks();
    };
  }, [task?.id]);

  useEffect(() => {
    if (!task) {
      setResolvedWorktreePath(null);
      setWorktreeResolveDetail(null);
      return;
    }
    let cancelled = false;
    const refreshWorktreePath = () => {
      void window.electronAPI.workspace
        .resolveTaskWorktree({ taskId: task.id, repoId: task.repoId, fluxxWorkBranch: task.fluxxWorkBranch })
        .then((r) => {
          if (!cancelled) {
            setResolvedWorktreePath(r.path);
            setWorktreeResolveDetail(r.detail ?? null);
          }
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
  }, [task?.id, task?.repoId, session?.id, session?.worktreePath, taskSessionStartPending]);

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
    if (sessionWorkspace) return;
    const stored = readStoredDetailWidth();
    if (stored != null) {
      setDetailWidth(clampDetailWidth(stored, maxDetailWidthForParent()));
    }
  }, [maxDetailWidthForParent, sessionWorkspace]);

  useEffect(() => {
    if (sessionWorkspace) return;
    const onResize = () => {
      setDetailWidth((prev) => clampDetailWidth(prev, maxDetailWidthForParent()));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [maxDetailWidthForParent, sessionWorkspace]);

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
    if (sessionWorkspace) return;
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
  }, [task?.id, sessionWorkspace]);

  useLayoutEffect(() => {
    if (sessionWorkspace) return;
    terminalRef.current?.fit();
  }, [sessionPaneHeightPx, session?.id, task?.id, sessionWorkspace]);

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
      if (
        existingSession &&
        (existingSession.status === 'running' ||
          existingSession.status === 'stopped' ||
          existingSession.status === 'error' ||
          existingSession.status === 'interrupted')
      ) {
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
  const sessionReadyForPty = Boolean(
    sessionId &&
      session?.status !== 'interrupted' &&
      (session?.status === 'running' ||
        session?.status === 'stopped' ||
        session?.status === 'error') &&
      !sessionWorkspace,
  );
  // Interactive mirror: same fixed-snapshot attach as read-only mirror (`getApplyAttachOptionsForViewPolicy`
  // is identical), but `interactionMode: 'interactive'` so `Terminal` wires `onData` → `sessions.write`.
  // Keep `viewPolicy` stable across running→stopped to avoid tearing down the PTY stream effect; stdin is
  // gated below with `sessionRunning`. If this panel and a workspace tab both show the same session, both
  // may write to one PTY when focused (same as multiple terminals attached to one session).
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
    if (!task || sessionWorkspace) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (assigneeChangeConfirm) return;
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [task, onClose, assigneeChangeConfirm, sessionWorkspace]);

  const assigneeSessionGuardActive = useMemo(
    () =>
      Boolean(
        cloudActiveRunnerSession ||
          taskSessionStartPending ||
          session?.status === 'running',
      ),
    [cloudActiveRunnerSession, taskSessionStartPending, session?.status],
  );

  const requestAssigneeChange = useCallback(
    (nextAssigneeId: string | null) => {
      if (!task) return;
      const cur = task.assigneeId?.trim() || null;
      const next = nextAssigneeId?.trim() || null;
      if (cur === next) {
        setAssigneeMenuOpen(false);
        return;
      }
      if (!assigneeSessionGuardActive) {
        onUpdate(task.id, { assigneeId: nextAssigneeId });
        setAssigneeMenuOpen(false);
        return;
      }
      setAssigneeMenuOpen(false);
      setAssigneeChangeConfirm({ nextAssigneeId });
    },
    [task, assigneeSessionGuardActive, onUpdate],
  );

  useLayoutEffect(() => {
    if (task == null || sessionWorkspace) return;
    setDetailWidth((prev) => clampDetailWidth(prev, maxDetailWidthForParent()));
  }, [task?.id, maxDetailWidthForParent, sessionWorkspace]);

  const handleStartSession = async (opts?: { resume?: boolean }) => {
    if (!task) return;
    if (task.agent == null) {
      setSessionError('Choose an agent for this task before starting a session.');
      return;
    }
    if (isTaskBlocked(task, projectTasks)) {
      setSessionError('Finish blocking tasks before starting a session.');
      return;
    }
    setSessionLoading(true);
    setSessionError(null);
    setSessionErrorCode(null);
    try {
      const result = await window.electronAPI.sessions.start(
        task,
        projectTasks,
        implicitSessionAssigneeUid ?? undefined,
        opts?.resume ? { resume: true } : undefined,
      );
      if ('error' in result) {
        setSessionErrorCode(result.error);
        if (result.error === 'TASK_BLOCKED') {
          setSessionError(result.message ?? 'This task is blocked by incomplete work.');
        } else if (result.error === 'NO_TASK_AGENT') {
          setSessionError(
            result.message ??
              'Choose Claude Code, Codex, or Cursor Agent for this task before starting a session.',
          );
        } else {
          setSessionError(
            sessionStartErrorMessage(result.error, result.message) ??
              result.message ??
              result.error,
          );
        }
        return;
      }
      setSessionErrorCode(null);
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

  const handleMinimizeFromPanel = () => {
    if (!session) return;
    onMinimizeSession(session.id);
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
    onDelete(task.id, { closeDetail: layout === 'board' });
  };

  const persistSourceMetadata = useCallback(async () => {
    if (!task || !branchDiscovery || repoFieldLocked) return;
    if (!gitBranchShortNameLooksValid(branchDraft)) return;
    const planned = planTaskSourceBranchFieldsForCreate(branchDiscovery, {
      sourceBranch: branchDraft.trim() === '' ? undefined : branchDraft,
    });
    const branchPersistPatch = buildTaskSourceBranchPersistPatch(planned, branchDiscovery);
    const branchNoOp = taskSourceBranchPersistIsNoOp(task, planned, branchDiscovery);
    const nextRepo = repoDraftId || effectiveTaskRepoId(task, primaryRepoId);
    const repoChanged = effectiveTaskRepoId(task, primaryRepoId) !== nextRepo;

    if (branchNoOp && !repoChanged) return;

    const combined: Partial<Task> = {};
    if (!branchNoOp) {
      Object.assign(combined, branchPersistPatch);
    }
    if (repoChanged && showRepoSection) {
      combined.repoId = nextRepo;
    }

    if (Object.keys(combined).length === 0) return;

    if (repoChanged && showRepoSection) {
      const r = await window.electronAPI.tasks.assertRepoIdEditable(
        task.id,
        { repoId: task.repoId, githubPr: task.githubPr, fluxxWorkBranch: task.fluxxWorkBranch },
        { repoId: nextRepo },
      );
      if (!r.ok) {
        setSourceMetadataError(r.message);
        return;
      }
    }

    if (!branchNoOp || (repoChanged && showRepoSection)) {
      const g = await window.electronAPI.tasks.assertSourceBranchEditable(
        task.id,
        {
          sourceBranch: task.sourceBranch,
          createSourceBranchIfMissing: task.createSourceBranchIfMissing,
          repoId: task.repoId,
          githubPr: task.githubPr,
          fluxxWorkBranch: task.fluxxWorkBranch,
        },
        {
          ...combined,
        },
      );
      if (!g.ok) {
        setSourceMetadataError(g.message);
        return;
      }
    }

    setSourceMetadataError(null);
    onUpdate(task.id, combined);
  }, [
    task,
    branchDiscovery,
    repoFieldLocked,
    branchDraft,
    repoDraftId,
    primaryRepoId,
    showRepoSection,
    onUpdate,
  ]);

  const sessionRunning = session?.status === 'running';
  const sshDevices = useMemo(
    () => executionDevices.filter((d) => d.kind === 'ssh' && d.enabled),
    [executionDevices],
  );

  if (!task) {
    return null;
  }

  const statusLabel = COLUMNS.find((c) => c.id === task.status)?.label ?? task.status;
  const startInFlight = sessionLoading || taskSessionStartPending;
  const showSessionStarting =
    startInFlight || (sessionRunning && !sessionStreamReady);
  const blocked = isTaskBlocked(task, projectTasks);
  const noAgentForSession = task.agent == null;
  const repoBlocked = projectRepoActionsBlocked(projectRepoReadiness);
  const startSessionControlDisabled =
    startInFlight || blocked || noAgentForSession || repoBlocked;
  const taskById = new Map(projectTasks.map((t) => [t.id, t]));
  const staleMissingIds = (task.blockedByTaskIds ?? []).filter((id) => !taskById.has(id));
  const unblockAutoStartCheckboxLocked = Boolean(
    implicitSessionAssigneeUid &&
      task.assigneeId?.trim() &&
      task.assigneeId !== implicitSessionAssigneeUid,
  );
  const effectiveWhenUnblockedAuto = whenUnblockedAutostartBoardChipEffective(
    task,
    autoStartWhenUnblockedProject,
  );
  const depQueryLower = depSearch.trim().toLowerCase();
  const pickCandidates = projectTasks.filter(
    (t) =>
      t.id !== task.id &&
      t.status !== 'done' &&
      !(task.blockedByTaskIds ?? []).includes(t.id) &&
      (depQueryLower === '' || t.title.toLowerCase().includes(depQueryLower)),
  );
  const descriptionRaw = task.description ?? '';
  const hasDescription = descriptionRaw.trim().length > 0;

  const effectiveRepoForLabel = effectiveTaskRepoId(task, primaryRepoId);
  const repoRowForLabel = findRepoByIdOrPrimary(projectRepos ?? [], effectiveRepoForLabel);
  const repoLabelDisplay = repoRowForLabel
    ? repoDisplayLabel(repoRowForLabel)
    : effectiveRepoForLabel || '—';
  const discoveryRepoForScope = findRepoByIdOrPrimary(projectRepos ?? [], discoveryRepoId);
  const branchScopeLabel =
    showRepoSection && discoveryRepoForScope
      ? repoDisplayLabel(discoveryRepoForScope)
      : undefined;

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

  const remoteFolderBindRepoId = task
    ? effectiveTaskRepoId(task, primaryRepoId)
    : primaryRepoId;
  const showRemoteFolderBinding =
    sessionErrorCode === 'REMOTE_FOLDER_REQUIRED' &&
    resolvedDevice?.kind === 'ssh' &&
    Boolean(remoteFolderBindRepoId.trim()) &&
    sshDevices.length > 0;

  const startButtonLabel = startInFlight
    ? 'Starting…'
    : sessionError
      ? 'Retry'
      : sessionStartButtonLabel(executionDevices, resolvedDevice);
  const startBtnPrimary =
    'rounded-lg bg-emerald-500/90 px-4 py-2 text-[13px] font-medium text-status-success-foreground shadow-sm transition hover:bg-emerald-400/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed';
  const startBtnIdle = `${startBtnPrimary} disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none`;
  const startBtnError =
    'rounded-lg border border-red-500/35 bg-red-500/[0.12] px-4 py-2 text-[13px] font-medium text-destructive-foreground transition hover:bg-red-500/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40';
  const startBtnLoading =
    'cursor-wait rounded-lg bg-muted px-4 py-2 text-[13px] font-medium text-muted-foreground';
  const markDoneBtn =
    'rounded-lg bg-muted/60 px-4 py-2 text-[13px] font-medium text-foreground ring-1 ring-inset ring-border transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const markDoneBtnDisabled =
    'cursor-not-allowed rounded-lg bg-muted px-4 py-2 text-[13px] font-medium text-muted-foreground ring-1 ring-inset ring-border';
  const validateBtnBase =
    'inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none';

  /** Any local session (running or after exit) — keep embedded terminal for buffer continuity. */
  const hasLocalSession = Boolean(session?.id);
  const sessionIdleAfterRun = hasLocalSession && !sessionRunning;
  const showResumeNewPair =
    sessionIdleAfterRun && taskAgentSupportsCliResume(task.agent);

  const showMarkAsDone = task.status !== 'done';
  const markDoneDisabled = showMarkAsDone && (markAsDoneBlocked || !onMarkAsDone);
  const showCleanUp =
    task.status === 'done' && !task.workspaceCleanedAt && Boolean(onRequestCleanupTask);
  const cleanUpDisabled = showCleanUp && (cleanupLoading || !onRequestCleanupTask);

  const panelShell = (
    <>
      {!sessionWorkspace ? (
        <TerminalResizeHandle
          orientation="vertical"
          aria-label="Resize task details"
          title="Drag to resize. Double-click to reset."
          onPointerDown={handleResizePointerDown}
          onDoubleClick={handleResizeDoubleClick}
        />
      ) : null}

      {/* Top bar: metadata + primary CTA + optional close (board overlay only) */}
      <header className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-md px-2.5 py-0.5 text-xs font-medium ${TASK_STATUS_CHIP[task.status]}`}
              >
                {statusLabel}
              </span>
              {task.createdAt ? (
                <span className="text-xs text-muted-foreground">Created {formatCreatedLabel(task.createdAt)}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {validateEligibility.canValidate ? (
                <button
                  type="button"
                  onClick={() => onUpdate(task.id, { status: 'validation' })}
                  title={validateEligibility.message}
                  className={cn(
                    validateBtnBase,
                    validateButtonClassNameForStatus(task.status),
                    task.status === 'needs-input' && 'shadow-sm',
                  )}
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                  Validate
                </button>
              ) : null}
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
              {showCleanUp ? (
                <button
                  type="button"
                  onClick={() => onRequestCleanupTask?.()}
                  disabled={cleanUpDisabled}
                  title={
                    cleanupLoading
                      ? gitEnabledProject
                        ? 'Cleaning up workspace…'
                        : 'Stopping sessions…'
                      : gitEnabledProject
                        ? 'Tear down agent session, terminals, and worktree for this task'
                        : 'Stop running agent sessions for this task'
                  }
                  className={cleanUpDisabled ? markDoneBtnDisabled : markDoneBtn}
                >
                  {cleanupLoading
                    ? gitEnabledProject
                      ? 'Cleaning up…'
                      : 'Stopping sessions…'
                    : gitEnabledProject
                      ? 'Clean up'
                      : 'Stop sessions'}
                </button>
              ) : null}
              <OpenInWorkspaceButton
                worktreePath={resolvedWorktreePath}
                disabledReason={
                  resolvedWorktreePath?.trim()
                    ? undefined
                    : worktreeResolveDetail?.message ?? undefined
                }
                size="md"
              />
              <GithubPrIconButton
                githubPr={task.githubPr}
                taskId={task.id}
                taskStatus={task.status}
                hasWorktree={Boolean(resolvedWorktreePath?.trim())}
                gitEnabled={gitEnabledProject}
                onTaskPrClick={onTaskPrClick}
                prLoading={prLoading}
                prAgentAwaiting={prAgentAwaiting}
              />
              {!sessionRunning ? (
                showResumeNewPair ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleStartSession({ resume: true })}
                      disabled={startSessionControlDisabled}
                      title={
                        blocked
                          ? 'Blocked by incomplete dependencies'
                          : noAgentForSession
                            ? 'Choose an agent below before starting a session'
                            : session?.agentConversationId
                              ? 'Continue the CLI session using the captured resume id (--resume <id>)'
                              : 'Continue the CLI session from disk (--resume)'
                      }
                      className={
                        startInFlight
                          ? startBtnLoading
                          : sessionError
                            ? startBtnError
                            : blocked || noAgentForSession
                              ? 'inline-flex cursor-not-allowed items-center justify-center rounded-lg bg-muted px-4 py-2 text-[13px] font-medium text-muted-foreground ring-1 ring-inset ring-border'
                              : startBtnIdle
                      }
                    >
                      {blocked ? (
                        <TaskBlockedSessionControlIcon
                          willAutoStartWhenUnblocked={effectiveWhenUnblockedAuto}
                        />
                      ) : noAgentForSession ? (
                        'No agent'
                      ) : sessionError ? (
                        'Retry'
                      ) : (
                        'Resume'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleStartSession()}
                      disabled={startSessionControlDisabled}
                      title={
                        blocked
                          ? 'Blocked by incomplete dependencies'
                          : noAgentForSession
                            ? 'Choose an agent below before starting a session'
                            : 'Start a new agent session with the full task prompt'
                      }
                      className={
                        startInFlight
                          ? startBtnLoading
                          : blocked || noAgentForSession
                            ? 'inline-flex cursor-not-allowed items-center justify-center rounded-lg bg-muted px-4 py-2 text-[13px] font-medium text-muted-foreground ring-1 ring-inset ring-border'
                            : markDoneBtn
                      }
                    >
                      {blocked ? (
                        <TaskBlockedSessionControlIcon
                          willAutoStartWhenUnblocked={effectiveWhenUnblockedAuto}
                        />
                      ) : noAgentForSession ? (
                        'No agent'
                      ) : (
                        'New session'
                      )}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleStartSession()}
                    disabled={startSessionControlDisabled}
                    title={
                      repoBlocked
                        ? projectRepoReadiness.message
                        : blocked
                          ? 'Blocked by incomplete dependencies'
                          : noAgentForSession
                            ? 'Choose an agent below before starting a session'
                            : undefined
                    }
                    className={
                      startInFlight
                        ? startBtnLoading
                        : sessionError
                          ? startBtnError
                          : blocked || noAgentForSession
                            ? 'inline-flex cursor-not-allowed items-center justify-center rounded-lg bg-muted px-4 py-2 text-[13px] font-medium text-muted-foreground ring-1 ring-inset ring-border'
                            : startBtnIdle
                    }
                  >
                    {blocked ? (
                      <TaskBlockedSessionControlIcon
                        willAutoStartWhenUnblocked={effectiveWhenUnblockedAuto}
                      />
                    ) : noAgentForSession ? (
                      'No agent'
                    ) : (
                      startButtonLabel
                    )}
                  </button>
                )
              ) : null}
              {sessionError && !sessionRunning ? (
                <p className="min-w-0 text-xs leading-snug text-destructive">{sessionError}</p>
              ) : null}
              {showRemoteFolderBinding && task ? (
                <div className="mt-3 min-w-0 rounded-lg border border-border/80 bg-muted/30 p-3">
                  <RemoteSshRepoBindingPanel
                    repoId={remoteFolderBindRepoId}
                    repoLabel={repoDisplayLabel(
                      findRepoByIdOrPrimary(projectRepos ?? [], remoteFolderBindRepoId) ?? {
                        id: remoteFolderBindRepoId,
                        rootPath: '',
                        baseBranch: 'main',
                      },
                    )}
                    sshDevices={sshDevices}
                    projectDefaultDeviceId={
                      resolvedDevice?.kind === 'ssh'
                        ? resolvedDevice.deviceId
                        : task.executionDevice?.deviceId
                    }
                  />
                </div>
              ) : null}
            </div>
          </div>
          {!sessionWorkspace ? (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <X className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}
        </header>

        <div ref={taskFormSplitRef} className="flex min-h-0 flex-1 flex-col">
          <div
            className="min-h-0 min-w-0 flex-1 overflow-y-auto"
            style={sessionWorkspace ? undefined : { minHeight: MIN_TASK_FORM_PANE_PX }}
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
                className="w-full resize-none bg-transparent text-2xl font-semibold leading-tight tracking-tight text-foreground placeholder:text-muted-foreground outline-none focus:outline-none focus-visible:ring-0"
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
                  <p className="text-xs text-muted-foreground">Agent & model</p>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <select
                      value={task.agent ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        const next: Agent | null = v === '' ? null : (v as Agent);
                        if (next === null) {
                          onUpdate(task.id, { agent: null });
                          return;
                        }
                        const patch: TaskPatch = { agent: next };
                        if (next !== task.agent) {
                          patch.agentYolo = false;
                          patch.agentModel = next === 'cursor' ? DEFAULT_CURSOR_AGENT_MODEL : '';
                        }
                        onUpdate(task.id, patch);
                      }}
                      className={cn('max-w-full shrink-0', AGENT_SPAWN_AGENT_SELECT_CLASS)}
                      aria-label="Agent provider"
                    >
                      {TASK_AGENT_SELECT_OPTIONS.map((a) => (
                        <option key={a.id === null ? 'none' : a.id} value={a.id === null ? '' : a.id}>
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
                    ) : task.agent === 'codex' ? (
                      <div className="min-w-0 max-w-[200px] flex-1 sm:max-w-xs">
                        <AgentModelPicker
                          kind="codex"
                          modelId={(task.agentModel ?? '').trim()}
                          onModelIdChange={(id) => onUpdate(task.id, { agentModel: id.trim() })}
                          aria-label="Codex model"
                        />
                      </div>
                    ) : null}
                    {task.agent != null ? (
                      <div ref={agentSettingsWrapRef} className="relative shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Agent spawn settings"
                          aria-expanded={agentSettingsOpen}
                          onClick={() => setAgentSettingsOpen((o) => !o)}
                          className="size-8 text-muted-foreground"
                        >
                          <Settings strokeWidth={1.75} aria-hidden />
                        </Button>
                        {agentSettingsOpen ? (
                          <div
                            className="absolute right-0 z-40 mt-1.5 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md"
                            role="dialog"
                            aria-label="Agent settings"
                          >
                            {task.agent === 'cursor' ? (
                              <label className="flex cursor-pointer items-start gap-2 text-foreground">
                                <Checkbox
                                  className="mt-0.5"
                                  checked={task.agentYolo === true}
                                  onCheckedChange={(checked) =>
                                    onUpdate(task.id, { agentYolo: checked === true })
                                  }
                                />
                                <span className="leading-snug">
                                  <span className="font-medium text-foreground">YOLO (Run Everything)</span>
                                  <span className="mt-1 block text-[11px] text-muted-foreground">
                                    Matches Cursor Agent <code className="text-muted-foreground">--yolo</code> /{' '}
                                    <code className="text-muted-foreground">--force</code>: fewer confirmation
                                    prompts; tools and shell commands run more freely unless explicitly
                                    denied.
                                  </span>
                                </span>
                              </label>
                            ) : task.agent === 'claude-code' ? (
                              <label className="flex cursor-pointer items-start gap-2 text-foreground">
                                <Checkbox
                                  className="mt-0.5"
                                  checked={task.agentYolo === true}
                                  onCheckedChange={(checked) =>
                                    onUpdate(task.id, { agentYolo: checked === true })
                                  }
                                />
                                <span className="leading-snug">
                                  <span className="font-medium text-foreground">Skip permission checks</span>
                                  <span className="mt-1 block text-[11px] text-muted-foreground">
                                    Passes <code className="text-muted-foreground">--dangerously-skip-permissions</code> to
                                    Claude Code. Anthropic recommends this only for trusted sandboxes.
                                  </span>
                                </span>
                              </label>
                            ) : task.agent === 'codex' ? (
                              <label className="flex cursor-pointer items-start gap-2 text-foreground">
                                <Checkbox
                                  className="mt-0.5"
                                  checked={task.agentYolo === true}
                                  onCheckedChange={(checked) =>
                                    onUpdate(task.id, { agentYolo: checked === true })
                                  }
                                />
                                <span className="leading-snug">
                                  <span className="font-medium text-foreground">YOLO (Run Everything)</span>
                                  <span className="mt-1 block text-[11px] text-muted-foreground">
                                    Passes Codex <code className="text-muted-foreground">--yolo</code> (alias for{' '}
                                    <code className="text-muted-foreground">--dangerously-bypass-approvals-and-sandbox</code>
                                    ): fewer approval prompts and broader sandbox access.
                                  </span>
                                </span>
                              </label>
                            ) : (
                              <p className="leading-relaxed text-muted-foreground">
                                No spawn toggles for this agent.
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="w-full min-w-0 sm:w-44 sm:shrink-0">
                  <Label htmlFor="task-status-select" className="mb-1.5 text-xs text-muted-foreground">
                    Status
                  </Label>
                  <Select
                    value={task.status}
                    onValueChange={(value) => onUpdate(task.id, { status: value as TaskStatus })}
                  >
                    <SelectTrigger id="task-status-select" className="h-8 text-xs font-medium" aria-label="Change status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {statusColumnOptions.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {executionDevices.length > 0 ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="shrink-0">
                    <p className="text-xs text-muted-foreground">Run on</p>
                    {sessionRunning ? (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Locked while the session is running.
                      </p>
                    ) : null}
                  </div>
                  <div className="min-w-0 sm:max-w-[min(18rem,100%)] sm:flex-1">
                    <ExecutionDevicePicker
                      id={`task-${task.id}-device`}
                      devices={executionDevices}
                      value={task.executionDevice ?? resolvedDevice}
                      onChange={(ref) => onUpdate(task.id, { executionDevice: ref })}
                      disabled={!isTaskExecutionDeviceEditable(session?.status)}
                      aria-label="Execution device"
                    />
                  </div>
                </div>
              ) : null}

              {projectMembers !== undefined ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <p className="shrink-0 text-xs text-muted-foreground">Assignee</p>
                  <div ref={assigneeMenuWrapRef} className="min-w-0 sm:max-w-[min(18rem,100%)] sm:flex-1">
                    <DropdownMenu
                      open={assigneeMenuOpen}
                      onOpenChange={setAssigneeMenuOpen}
                    >
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          id="task-assignee-trigger"
                          variant="outline"
                          className="h-8 w-full justify-start gap-2 px-2.5 text-xs font-medium"
                        >
                          {task.assigneeId && selectedAssigneeMember ? (
                            <>
                              <ProjectMemberAvatar member={selectedAssigneeMember} size="sm" />
                              <span className="min-w-0 flex-1 truncate text-left">
                                {projectMemberDisplayLabel(selectedAssigneeMember)}
                              </span>
                            </>
                          ) : task.assigneeId ? (
                            <>
                              <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-medium text-muted-foreground">
                                ?
                              </div>
                              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                Unknown member
                              </span>
                            </>
                          ) : (
                            <>
                              <UserCircle2
                                className="size-5 shrink-0 text-muted-foreground"
                                strokeWidth={1.5}
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                Unassigned
                              </span>
                            </>
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        id="task-assignee-listbox"
                        align="start"
                        className="max-h-56 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
                      >
                        <DropdownMenuItem
                          className="gap-2 text-xs"
                          onSelect={() => requestAssigneeChange(null)}
                        >
                          <UserCircle2
                            className="size-5 shrink-0 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden
                          />
                          <span className="text-muted-foreground">Unassigned</span>
                        </DropdownMenuItem>
                        {projectMembers.map((m) => (
                          <DropdownMenuItem
                            key={m.uid}
                            className={cn(
                              'gap-2 text-xs',
                              task.assigneeId === m.uid && 'bg-accent',
                            )}
                            onSelect={() => requestAssigneeChange(m.uid)}
                          >
                            <ProjectMemberAvatar member={m} size="sm" />
                            <span className="min-w-0 flex-1 truncate">
                              {projectMemberDisplayLabel(m)}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ) : null}

              <div className="border-t border-border pt-4">
                {showRepoSection ? (
                  <div className="mb-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Repository
                    </p>
                    {repoFieldLocked ? (
                      <p className="mt-1.5 text-[13px] text-foreground">{repoLabelDisplay}</p>
                    ) : (
                      <Select
                        value={repoDraftId}
                        onValueChange={(value) => {
                          setRepoDraftId(value);
                        }}
                      >
                        <SelectTrigger
                          id={`task-${task.id}-repo`}
                          className={cn('mt-1.5 h-8 text-xs font-medium')}
                          onBlur={() => void persistSourceMetadata()}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {(projectRepos ?? []).map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {repoDisplayLabel(r)}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ) : null}

                <TaskSourceBranchPicker
                  gitEnabled={gitEnabledProject}
                  variant="panel"
                  idPrefix={`task-${task.id}-branch`}
                  branchInput={branchDraft}
                  onBranchInputChange={setBranchDraft}
                  discovery={branchDiscovery}
                  discoveryLoading={branchDiscoveryLoading}
                  discoveryError={branchDiscoveryError}
                  editable={!repoFieldLocked}
                  repoScopeLabel={branchScopeLabel}
                  onInputBlur={() => void persistSourceMetadata()}
                />
                {gitEnabledProject && sourceMetadataError ? (
                  <p className="mt-2 text-[11px] leading-snug text-destructive" role="alert">
                    {sourceMetadataError}
                  </p>
                ) : null}
                {gitEnabledProject && repoFieldLocked ? (
                  <p className="mt-2 text-[11px] leading-snug text-status-needs-input-foreground">
                    {task.githubPr?.url?.trim()
                      ? 'Repository and source branch cannot be edited while a GitHub pull request is linked to this task. Clear the pull request metadata first.'
                      : 'The repository and source branch are fixed once there is a worktree or any agent session for this task (including after the session ends), or while a session is starting. On cloud projects, metadata is shared with your team; git branch lists are always read from this computer.'}
                  </p>
                ) : gitEnabledProject ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Updates when you leave the repository or branch field. If session start fails
                    locally, check the error message and your clone.
                  </p>
                ) : null}
              </div>
            </div>

            <div
              className="flex gap-1 border-b border-border px-5 pt-1"
              role="tablist"
              aria-label="Task detail sections"
            >
              {(
                [
                  ['implementation', 'Implementation'],
                  ...(validationEnabledProject
                    ? ([['validation', 'Validation']] as const)
                    : []),
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={detailContentTab === id}
                  onClick={() => setDetailContentTab(id)}
                  className={[
                    'rounded-t-lg px-3 py-2 text-[12px] font-medium transition',
                    detailContentTab === id
                      ? 'bg-muted/60 text-foreground ring-1 ring-inset ring-border ring-b-transparent'
                      : 'text-muted-foreground hover:text-foreground/80',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>

            {detailContentTab === 'implementation' ? (
              <>
            {/* Description: read-first, edit on demand */}
            <section
              className="border-t border-border bg-muted/30 px-5 py-5"
              aria-label="Description"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-foreground/80">Description</h2>
                {!descriptionEditing ? (
                  <button
                    type="button"
                    onClick={() => setDescriptionEditing(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    {hasDescription ? 'Edit' : 'Add details'}
                  </button>
                ) : null}
              </div>
              {descriptionEditing ? (
                <Textarea
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
                  className="min-h-[8rem] resize-y text-[13px] leading-[1.65]"
                />
              ) : (
                <div className="group relative min-h-[3rem]">
                  {hasDescription ? (
                    <MarkdownContent className={MD_READ_CLASS} density="panel">
                      {descriptionRaw}
                    </MarkdownContent>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDescriptionEditing(true)}
                      className="w-full rounded-xl border border-dashed border-border bg-transparent py-8 text-left text-sm text-muted-foreground transition hover:border-border hover:bg-muted/30 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      No description yet. Click to add plan, criteria, or notes.
                    </button>
                  )}
                </div>
              )}
            </section>

            {onOpenPlanningDoc ? (
              <section
                className="border-t border-border/60 px-5 py-5"
                aria-label="Attached planning documents"
              >
                <div className="rounded-2xl border border-border bg-card px-3.5 py-3">
                  <h2 className="mb-1 text-sm font-medium text-card-foreground">Attached docs</h2>
                  <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
                    Link planning markdown for quick access. Opens in the Docs workspace.
                  </p>
                  {attachedPlanningPaths.length === 0 ? (
                    <p className="mb-2 text-xs text-muted-foreground">No documents attached.</p>
                  ) : (
                    <ul className="mb-2 flex flex-wrap gap-1.5" role="list">
                      {attachedPlanningPaths.map((relPath) => {
                        const presence = attachedPlanningDocChipPresence(
                          relPath,
                          planningDocPathSet,
                          planningDocsListFetched,
                          planningDocsListLoading,
                        );
                        const label = compactPlanningDocPathLabel(relPath);
                        const missing = presence === 'missing';
                        return (
                          <li key={relPath} className="flex max-w-full items-stretch">
                            {missing ? (
                              <Badge
                                variant="outline"
                                className="max-w-[min(100%,14rem)] gap-1 rounded-r-none rounded-l-lg border-status-needs-input/30 bg-status-needs-input/10 py-1 pl-2 pr-1 text-[11px] font-medium text-status-needs-input-foreground line-through"
                                title={`${relPath} — not found in planning docs list`}
                                aria-label={`Missing planning document ${relPath}`}
                              >
                                <FileText data-icon="inline-start" aria-hidden />
                                <span className="min-w-0 truncate">{label}</span>
                              </Badge>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenPlanningDoc(relPath)}
                                title={relPath}
                                aria-label={`Open planning document ${relPath}`}
                                className="h-auto max-w-[min(100%,14rem)] gap-1 rounded-r-none rounded-l-lg border-r-0 py-1 pl-2 pr-1 text-[11px] font-medium text-primary"
                              >
                                <FileText data-icon="inline-start" aria-hidden />
                                <span className="min-w-0 truncate">{label}</span>
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-auto shrink-0 rounded-l-none rounded-r-lg px-1.5"
                              onClick={() => {
                                const docs = task.attachedPlanningDocs ?? [];
                                const next = docs.filter((d) => d.relativePath !== relPath);
                                onUpdate(task.id, {
                                  attachedPlanningDocs: next.length > 0 ? next : [],
                                });
                              }}
                              title={`Remove ${relPath}`}
                              aria-label={`Remove attached document ${relPath}`}
                            >
                              <X data-icon="inline-start" aria-hidden />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {planningDocFiles.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No planning docs loaded for this project yet.
                    </p>
                  ) : attachablePlanningDocs.length === 0 ? (
                    attachedPlanningPaths.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        All planning documents are already attached.
                      </p>
                    ) : null
                  ) : (
                    <AttachPlanningDocSelect
                      attachablePlanningDocs={attachablePlanningDocs}
                      resetKey={attachedPlanningPaths.join('\0')}
                      onAttach={(relativePath) => {
                        const docs = task.attachedPlanningDocs ?? [];
                        const next = sanitizeTaskAttachedPlanningDocsInput([
                          ...docs,
                          { relativePath },
                        ]);
                        onUpdate(task.id, { attachedPlanningDocs: next });
                      }}
                    />
                  )}
                </div>
              </section>
            ) : null}

            <div className="space-y-4 px-5 py-5">
              {staleMissingIds.length > 0 ? (
                <div
                  className="rounded-xl border border-status-needs-input/25 bg-status-needs-input/10 px-3.5 py-2.5 text-sm leading-relaxed text-status-needs-input-foreground"
                  role="status"
                >
                  <p className="text-xs text-status-needs-input-foreground/80">
                    {staleMissingIds.length} reference{staleMissingIds.length === 1 ? '' : 's'} missing
                    from the board — remove {staleMissingIds.length === 1 ? 'it' : 'them'} below.
                  </p>
                </div>
              ) : null}

              <section className="space-y-2" aria-label="Dependencies">
                <h2 className="text-sm font-medium text-foreground/80">Blockers & dependencies</h2>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  This task stays blocked until every listed dependency is done. Missing task ids are ignored
                  for blocking logic.
                </p>
                {task.status !== 'done' && (task.blockedByTaskIds ?? []).length > 0 ? (
                  <label
                    title={
                      unblockAutoStartCheckboxLocked
                        ? 'Only the assignee can change this setting for this task'
                        : undefined
                    }
                    className={`flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 ${
                      unblockAutoStartCheckboxLocked
                        ? 'cursor-not-allowed opacity-70'
                        : 'cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={unblockAutoStartCheckboxLocked}
                      checked={effectiveWhenUnblockedAuto}
                      onChange={(e) => {
                        if (unblockAutoStartCheckboxLocked) return;
                        const want = e.target.checked;
                        if (want === effectiveWhenUnblockedAuto) return;
                        onUpdate(
                          task.id,
                          patchAutoStartOnUnblockAfterToggle(task, autoStartWhenUnblockedProject),
                        );
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-input bg-background disabled:cursor-not-allowed"
                    />
                    <span className="min-w-0">
                      <span className="text-[13px] font-medium text-foreground">
                        Auto-start when unblocked
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                        Matches the board chip: when on, a session starts as soon as the last
                        dependency completes. You can opt this task out even if the project default
                        is on, or opt in when the default is off.
                        {unblockAutoStartCheckboxLocked ? (
                          <span className="mt-1 block text-muted-foreground">
                            Only the assignee can edit this while the task is assigned to someone
                            else.
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </label>
                ) : null}
                {(task.blockedByTaskIds ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No dependencies — this task is not waiting on other work.</p>
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
                            className="flex min-h-[2.75rem] items-stretch gap-0 overflow-hidden rounded-lg bg-muted/40 ring-1 ring-inset ring-border transition hover:bg-muted/60"
                          >
                            <button
                              type="button"
                              onClick={() => onSelectTask(bid)}
                              className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm text-foreground transition hover:text-white"
                            >
                              <span className="line-clamp-2 font-medium">{other.title || '(Untitled)'}</span>
                              <span className="ml-2 inline-block align-middle text-xs text-muted-foreground">Open →</span>
                            </button>
                            <div className="flex shrink-0 items-center gap-1 border-l border-border pl-1 pr-1.5">
                              <span
                                className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${TASK_STATUS_CHIP[other.status]}`}
                              >
                                {stLabel}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeBlocker(bid)}
                                className="rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
                          className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 ring-1 ring-inset ring-amber-500/15"
                        >
                          <span className="min-w-0 text-sm text-muted-foreground">
                            Missing on board <code className="text-muted-foreground">{bid}</code>
                          </span>
                          <button
                            type="button"
                            onClick={() => removeBlocker(bid)}
                            className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          >
                            Remove
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="pt-1">
                  {dependencyAddOpen ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Add a blocker or dependency</span>
                        <button
                          type="button"
                          onClick={() => {
                            setDependencyAddOpen(false);
                            setDepSearch('');
                            setDependencyError(null);
                          }}
                          className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Cancel
                        </button>
                      </div>
                      <input
                        type="search"
                        value={depSearch}
                        onChange={(e) => setDepSearch(e.target.value)}
                        placeholder="Add dependency by search…"
                        className="w-full rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground ring-1 ring-inset ring-border outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Search tasks to add as dependencies"
                      />
                      {dependencyError ? (
                        <p className="text-xs text-destructive" role="alert">
                          {dependencyError}
                        </p>
                      ) : null}
                      {pickCandidates.length > 0 ? (
                        <ul
                          className="max-h-40 overflow-y-auto rounded-lg bg-card py-1 ring-1 ring-inset ring-border"
                          role="listbox"
                          aria-label="Tasks matching your search"
                        >
                          {pickCandidates.slice(0, 50).map((t) => {
                            const stLabel =
                              COLUMNS.find((c) => c.id === t.status)?.label ?? t.status;
                            return (
                              <li key={t.id}>
                                <button
                                  type="button"
                                  onClick={() => addBlocker(t.id)}
                                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-foreground transition hover:bg-accent"
                                >
                                  <span className="min-w-0 truncate">{t.title || '(Untitled)'}</span>
                                  <span className="shrink-0 text-xs text-muted-foreground">{stLabel}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : depSearch.trim() ? (
                        <p className="text-xs text-muted-foreground">No matching tasks.</p>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDependencyAddOpen(true)}
                      className="w-full rounded-lg border border-dashed border-border bg-transparent px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:border-border hover:bg-muted/30 hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Add dependency
                    </button>
                  )}
                </div>
              </section>
            </div>
              </>
            ) : null}

            {detailContentTab === 'validation' ? (
              validationEnabledProject ? (
                <TaskValidationSection
                  task={task}
                  primaryRepoId={primaryRepoId}
                  worktreePath={resolvedWorktreePath}
                  projectRepoReadiness={projectRepoReadiness}
                  onUpdate={onUpdate}
                />
              ) : (
                <section className="border-t border-border px-5 py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Validation is disabled for this project.
                  </p>
                  {onOpenProjectSettings ? (
                    <button
                      type="button"
                      onClick={onOpenProjectSettings}
                      className="mt-3 text-[13px] font-medium text-sky-400/90 underline-offset-2 hover:underline"
                    >
                      Enable in Project settings → Experimental
                    </button>
                  ) : null}
                </section>
              )
            ) : null}
          </div>

          {!sessionWorkspace ? (
            <>
              <TerminalResizeHandle
                orientation="horizontal"
                aria-label="Resize between task details and session output"
                title="Drag to resize session. Double-click to reset."
                onPointerDown={handleSessionSplitPointerDown}
                onDoubleClick={handleSessionSplitDoubleClick}
                onKeyDown={onSessionSplitKeyDown}
              />

              {/* Session: secondary when idle; compact chrome when live */}
              <div
            className="flex min-w-0 min-h-0 shrink-0 flex-col overflow-hidden bg-status-terminal text-status-terminal-foreground"
            style={{ height: sessionPaneHeightPx }}
          >
            {sessionRunning && session ? (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-status-terminal-foreground/10 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-status-success" />
                  <span className="truncate text-xs font-medium text-status-terminal-foreground/70">
                    Session running
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenInTab}
                    className="h-auto px-2.5 py-1 text-xs text-status-terminal-foreground/70 hover:bg-status-terminal-foreground/10 hover:text-status-terminal-foreground"
                  >
                    Open in tab
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleMinimizeFromPanel}
                    title="Minimize — hide from sidebar, keep agent running"
                    className="h-auto px-2.5 py-1 text-xs text-status-terminal-foreground/70 hover:bg-status-terminal-foreground/10 hover:text-status-terminal-foreground"
                  >
                    Minimize
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-status-terminal-foreground/55">
                  <Terminal className="size-3.5 opacity-70" strokeWidth={2} aria-hidden />
                  {sessionIdleAfterRun ? 'Session output (ended)' : 'Output'}
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
              {remoteRunner && !session ? (
                <div className="flex h-full min-h-[7rem] flex-col items-center justify-center gap-2 rounded-xl border border-status-terminal-foreground/10 bg-status-terminal-foreground/[0.03] px-4 py-6 text-center">
                  <div className="flex items-center gap-2.5 text-sm text-status-terminal-foreground">
                    <ProjectMemberAvatar
                      member={{
                        uid: remoteRunner.uid,
                        displayName: remoteRunner.displayName,
                        photoURL: remoteRunner.photoURL,
                      }}
                      size="sm"
                    />
                    <span className="inline-flex size-2 shrink-0 animate-pulse rounded-full bg-status-success" />
                    <span className="min-w-0 font-medium">
                      {remoteRunner.displayName ?? 'A teammate'} has a Fluxx Desktop session
                    </span>
                  </div>
                  <p className="max-w-[18rem] text-xs leading-relaxed text-status-terminal-foreground/60">
                    Their terminal stays on their computer. Direct SSH tasks require Fluxx Desktop on
                    the machine that owns the SSH connection — you cannot start or attach from the web.
                  </p>
                </div>
              ) : !hasLocalSession ? (
                <div className="relative flex h-full min-h-[6.5rem] flex-col">
                  {showSessionStarting ? (
                    <TerminalAttachLoading
                      label="Starting…"
                      className="rounded-xl border-status-terminal-foreground/15"
                    />
                  ) : null}
                  {repoBlocked && !sessionRunning && !session ? (
                    <p
                      className="mb-2 rounded-lg border border-status-needs-input/25 bg-status-needs-input/10 px-3 py-2 text-xs text-status-needs-input-foreground"
                      role="status"
                    >
                      {projectRepoReadiness.message}{' '}
                      {onOpenProjectSettings ? (
                        <button
                          type="button"
                          onClick={onOpenProjectSettings}
                          className="font-medium underline decoration-status-needs-input/50 underline-offset-2 hover:decoration-status-needs-input"
                        >
                          {projectRepoReadiness.ctaLabel}
                        </button>
                      ) : null}
                    </p>
                  ) : blocked && !sessionRunning && !session ? (
                    <p
                      className="mb-2 rounded-lg border border-status-needs-input/25 bg-status-needs-input/10 px-3 py-2 text-xs text-status-needs-input-foreground"
                      role="status"
                    >
                      Start session is off until blockers are cleared.
                    </p>
                  ) : null}
                  <div className="flex min-h-[5rem] flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-status-terminal-foreground/15 bg-status-terminal-foreground/[0.03] px-4 py-5 text-center">
                    <p className="text-sm text-status-terminal-foreground/70">No live session in this panel</p>
                    <p className="max-w-sm text-xs leading-relaxed text-status-terminal-foreground/50">
                      {blocked
                        ? 'Unblock the task, then use Start session above. Output streams here and in a workspace tab.'
                        : 'When you start a session, the agent’s terminal streams here. Open in a tab for the full view.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="relative h-full min-h-[120px]">
                  {showSessionStarting ? <TerminalAttachLoading label="Starting…" /> : null}
                  <TerminalComponent
                    ref={terminalRef}
                    sessionId={session?.id ?? null}
                    onData={sessionRunning ? handleTerminalData : undefined}
                    autoFit={terminalShouldAutoFit(INTERACTIVE_MIRROR_TERMINAL_VIEW_POLICY)}
                    hideCursor
                  />
                </div>
              )}
            </div>
          </div>
            </>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            onClick={handleDelete}
            className="h-auto px-0 text-sm text-muted-foreground hover:bg-transparent hover:text-destructive"
          >
            Delete task
          </Button>
        </div>
    </>
  );

  return (
    <>
      {!sessionWorkspace ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close task details"
          className="absolute inset-0 z-10 bg-black/30"
          onClick={onClose}
        />
      ) : null}
      {createElement(
        sessionWorkspace ? 'div' : 'aside',
        sessionWorkspace
          ? {
              className: 'flex h-full min-h-0 min-w-0 flex-col bg-background',
              role: 'region' as const,
              'aria-label': 'Task details',
            }
          : {
              ref: asideRef,
              style: { width: detailWidth } as CSSProperties,
              className:
                'absolute inset-y-0 right-0 z-20 flex min-w-0 flex-col border-l border-border bg-background shadow-[0_0_0_1px_rgba(255,255,255,0.04),-12px_0_40px_rgba(0,0,0,0.45)]',
              role: 'dialog' as const,
              'aria-modal': true as const,
              'aria-labelledby': 'task-detail-title',
            },
        panelShell,
      )}
      {assigneeChangeConfirm ? (
        <ConfirmDialog
          title="Change assignee with an active session?"
          description="Are you sure you want to change the assignee?"
          confirmLabel="Change assignee"
          onConfirm={() => {
            if (!task) return;
            onUpdate(task.id, { assigneeId: assigneeChangeConfirm.nextAssigneeId });
            setAssigneeChangeConfirm(null);
          }}
          onCancel={() => setAssigneeChangeConfirm(null)}
        />
      ) : null}
    </>
  );
}
