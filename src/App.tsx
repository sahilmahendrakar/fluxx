import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { DropResult } from '@hello-pangea/dnd';
import {
  AGENTS,
  COLUMNS,
  Task,
  TaskStatus,
  Agent,
  CloudProject,
  LocalProject,
  Session,
  type ActiveProjectKey,
  type CloudRepoBindingOverview,
  type PlanningSession,
  type ProjectTabState,
  type RepoConfig,
  type TaskPrErrorCode,
  type TaskPullRequestIpcResult,
  type TaskRequestPullRequestFromAgentResult,
} from './types';
import Board from './components/Board';
import { PlanningPanel } from './components/PlanningPanel';
import { PlanningDocsView } from './components/PlanningDocsView';
import TaskDetailPanel from './components/TaskDetailPanel';
import { AppShell } from './components/AppShell';
import { TopBar } from './components/TopBar';
import { LoadingScreen } from './components/LoadingScreen';
import { ProjectsListView } from './components/ProjectsListView';
import { SignInCard } from './components/SignInCard';
import { ProjectSettingsView } from './components/ProjectSettingsView';
import { TabBar, buildSessionTabs } from './components/TabBar';
import { SessionTerminalView } from './components/SessionTerminalView';
import ConfirmDialog from './components/ConfirmDialog';
import { taskDeleteNeedsWorkspaceConfirmation } from './taskDeleteWorkspaceConfirmation';
import { useAuth } from './renderer/auth/useAuth';
import { useCloudProjects } from './renderer/projects/useCloudProjects';
import { useMembers } from './renderer/projects/useMembers';
import { useInvites } from './renderer/invites/useInvites';
import {
  useAgentHeartbeat,
  useRunners,
} from './renderer/runners/useRunners';
import type { RunnerEntry } from './renderer/runners/runners';
import type { ProjectMember } from './renderer/projects/members';
import type { TaskPatch, TaskProvider } from './renderer/tasks/TaskProvider';
import { LocalTaskProvider } from './renderer/tasks/LocalTaskProvider';
import { FirestoreTaskProvider } from './renderer/tasks/FirestoreTaskProvider';
import { useGithubPrBoardRefresh } from './renderer/tasks/useGithubPrBoardRefresh';
import { applyGithubPrRefreshFromRenderer } from './renderer/tasks/applyGithubPrRefreshFromRenderer';
import {
  formatGithubPrDiscoveryFailure,
  isBenignPrDiscoveryWhileAgentWorking,
  shouldStopPrAgentFollowupDiscovery,
  type GithubPrDiscoveryMessageContext,
} from './githubPrDiscoveryMessages';
import {
  reconcileCloudSilenceFromDaemon,
  useCloudSilenceReconciliation,
} from './renderer/tasks/useCloudSilenceReconciliation';
import { keyForInsert, sortColumn } from './renderer/tasks/orderKey';
import { normalizeTaskLabels } from './taskLabels';
import { selectSessionForTaskWorkspace } from './sessionWorkspacePick';
import { invalidateSessionAttachCache } from './terminal/warmAttach';
import { isTaskBlocked, taskIdsToClearAutoStartOnUnblockWhenAutomationEnables } from './taskDependencies';
import { useCloudPlanningDocsMigration } from './renderer/planningDocs/useCloudPlanningDocsMigration';
import { useRendererAutomationBridge } from './renderer/automation/useRendererAutomationBridge';
import { usePlanningDocsFirestorePush } from './renderer/planningDocs/usePlanningDocsFirestorePush';
import { usePlanningDocsFirestoreSync } from './renderer/planningDocs/usePlanningDocsFirestoreSync';
import { isFirebaseConfigured } from './renderer/firebase';
import { maybeCloudAutoStartSessionOnInProgressTransition } from './cloudInProgressAutostartApply';
import { runCloudDoneTransitionFollowUp } from './cloudTaskDoneFollowUp';
import { assigneePatchForCloudAutoStartOnUnblock } from './cloudAutoStartUnblockAssignee';
import { applyUnblockAutostartForCompletedBlocker } from './unblockAutostartApply';
import type { UnblockAutostartPolicy } from './unblockAutostart';
import {
  defaultTaskAgentForProject,
  hydrateCloudProject,
  primaryRootPathFromCloudBinding,
} from './cloudBindingPrefs';
import type { PlanningDocFileEntry, PlanningDocsCloudListMeta } from './planningDocs/types';
import { mergedTaskCreateAgentFields } from './projectAgentDefaults';
import { mergeMemberPhotoURL } from './renderer/projects/cloudProjects';
import {
  leaveSettingsIfActive,
  pushProjectSettingsRoute,
  readProjectHashRoute,
  replaceProjectWorkspaceRoute,
  useProjectHashRoute,
} from './projectHashRoute';
import { normalizeRestoredProjectTabState } from './projectTabRestore';

type ActiveProject = LocalProject | CloudProject;

const UPDATE_DEBOUNCE_MS = 300;
/** Minimum spacing between suppressed `pending-agent` PR discoveries (silence + timed retries). */
const PENDING_AGENT_PR_DISCOVERY_MIN_GAP_MS = 4500;
const STATIC_TAB_IDS = new Set(['board', 'plan', 'docs']);
const PLAN_TAB_PREFIX = 'plan:';

function planTabId(sessionId: string): string {
  return `${PLAN_TAB_PREFIX}${sessionId}`;
}

function parsePlanTabId(tabId: string): string | null {
  if (!tabId.startsWith(PLAN_TAB_PREFIX)) return null;
  const id = tabId.slice(PLAN_TAB_PREFIX.length);
  return id.length > 0 ? id : null;
}

function isWorkspaceSessionTabId(tabId: string): boolean {
  if (STATIC_TAB_IDS.has(tabId)) return false;
  if (tabId.startsWith(PLAN_TAB_PREFIX)) return false;
  return true;
}

/** Apply debounced cloud patches onto a server task for optimistic UI (`null` clears optional fields). */
function mergeServerTaskWithPendingPatch(task: Task, patch: TaskPatch | undefined): Task {
  if (!patch) return task;
  const {
    assigneeId,
    workspaceCleanedAt,
    githubPr,
    sourceBranch,
    createSourceBranchIfMissing,
    autoStartOnUnblock,
    repoId,
    ...rest
  } = patch;
  let next: Task = { ...task, ...rest };
  if (assigneeId !== undefined) {
    if (assigneeId === null || assigneeId === '') {
      next = { ...next };
      delete next.assigneeId;
    } else {
      next = { ...next, assigneeId };
    }
  }
  if (workspaceCleanedAt !== undefined) {
    if (workspaceCleanedAt === null) {
      next = { ...next };
      delete next.workspaceCleanedAt;
    } else {
      next = { ...next, workspaceCleanedAt };
    }
  }
  if (githubPr !== undefined) {
    if (githubPr === null) {
      next = { ...next };
      delete next.githubPr;
    } else {
      next = { ...next, githubPr };
    }
  }
  if (sourceBranch !== undefined) {
    if (typeof sourceBranch === 'string' && sourceBranch.trim() === '') {
      next = { ...next };
      delete next.sourceBranch;
    } else {
      next = { ...next, sourceBranch };
    }
  }
  if (createSourceBranchIfMissing !== undefined) {
    if (createSourceBranchIfMissing) {
      next = { ...next, createSourceBranchIfMissing: true };
    } else {
      next = { ...next };
      delete next.createSourceBranchIfMissing;
    }
  }
  if (autoStartOnUnblock !== undefined) {
    if (autoStartOnUnblock === null) {
      next = { ...next };
      delete next.autoStartOnUnblock;
    } else {
      next = { ...next, autoStartOnUnblock };
    }
  }
  if (repoId !== undefined) {
    if (typeof repoId === 'string' && repoId.trim() === '') {
      next = { ...next };
      delete next.repoId;
    } else {
      next = { ...next, repoId };
    }
  }
  return next;
}

/** Server rows can omit optional fields; keep local values unless the server set them. */
function mergeTaskRowPreserveMissing(local: Task, server: Task): Task {
  return { ...local, ...server };
}

function mergeServerTaskWithPendingPatchOntoLocal(
  local: Task,
  server: Task,
  patch: TaskPatch | undefined,
): Task {
  return mergeServerTaskWithPendingPatch(mergeTaskRowPreserveMissing(local, server), patch);
}

const TASK_PR_ERROR_HINTS: Partial<Record<TaskPrErrorCode, string>> = {
  NO_PROJECT: 'Open a project workspace in Flux, then try again.',
  NO_WORKTREE:
    "Start this task's agent session so Flux has a live worktree, then try opening the PR again.",
  NO_AGENT_SESSION:
    'Open the task and start its agent session from the board or task panel, then click the PR icon again.',
  AGENT_SESSION_NOT_RUNNING:
    "Return to the task's session tab and start or resume the agent, then try opening the PR again.",
  GH_NOT_INSTALLED: 'Install the GitHub CLI (`gh`) and ensure it is on your PATH.',
  GH_AUTH_FAILED: 'Run `gh auth login` in a terminal, then try again.',
  NO_GITHUB_REMOTE: 'Point `origin` at GitHub or add a `github.com` remote, then try again.',
  BRANCH_PUSH_FAILED: 'Fix the push error shown above (permissions, network, or diverged history), then retry.',
  PR_CREATE_FAILED: 'Check the GitHub CLI output for details, then retry.',
  TASK_METADATA_REQUIRED: 'Ensure this task has a title (edit the task if needed), then try again.',
  PR_REPO_MISMATCH:
    "This pull request is for a different GitHub repository than this task's clone. Check the task's repository and the linked PR URL, then try again.",
};

type TaskPrIpcFailure = Extract<
  TaskPullRequestIpcResult | TaskRequestPullRequestFromAgentResult,
  { ok: false }
>;

function formatTaskPullRequestError(result: TaskPrIpcFailure): string {
  const hint = TASK_PR_ERROR_HINTS[result.code];
  return hint ? `${result.message}\n${hint}` : result.message;
}

const PLANNING_PANEL_WIDTH_KEY = 'flux.planningPanelWidth';
const DEFAULT_PLANNING_PANEL_WIDTH = 288;
const MIN_PLANNING_PANEL_WIDTH = 260;
const MIN_BOARD_REMAINING_PX = 200;

function clampPlanningWidth(width: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(MIN_PLANNING_PANEL_WIDTH, Math.round(width)));
}

function readStoredPlanningWidth(): number | null {
  try {
    const raw = localStorage.getItem(PLANNING_PANEL_WIDTH_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export default function App() {
  const isMac = window.electronAPI.platform === 'darwin';
  const [project, setProject] = useState<ActiveProject | null>(null);
  const [activationLoading, setActivationLoading] = useState(true);
  const [pendingCloudActive, setPendingCloudActive] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<string>('board');
  const [sessions, setSessions] = useState<Session[]>([]);
  /** Task ids whose session is being created in main (worktree + spawn); see `onTaskStartProgress` */
  const [sessionStartPendingTaskIds, setSessionStartPendingTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [openTabIds, setOpenTabIds] = useState<Set<string>>(() => new Set());
  /** Daemon session ids hidden from the Task Workspaces sidebar (non-destructive minimize). */
  const [minimizedWorkspaceIds, setMinimizedWorkspaceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('flux.sidebarCollapsed') === '1';
    } catch {
      return false;
    }
  });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [taskDeleteConfirmId, setTaskDeleteConfirmId] = useState<string | null>(null);
  const [cleanupConfirmTaskId, setCleanupConfirmTaskId] = useState<string | null>(null);
  const [cleanupLoadingTaskId, setCleanupLoadingTaskId] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [prLoadingTaskId, setPrLoadingTaskId] = useState<string | null>(null);
  const [taskPrError, setTaskPrError] = useState<string | null>(null);
  /** Per-task: Flux task worktree exists on disk or is tied to a session worktree path. */
  const [taskHasWorktreeById, setTaskHasWorktreeById] = useState<Record<string, boolean>>({});
  const [planPanelOpen, setPlanPanelOpen] = useState(false);
  /** Persisted: user wants the board planning strip open (see {@link ProjectTabState.planningSidebarOpen}). */
  const [planningSidebarOpen, setPlanningSidebarOpen] = useState(false);
  const [planPanelWidth, setPlanPanelWidth] = useState(DEFAULT_PLANNING_PANEL_WIDTH);
  const [planningSessions, setPlanningSessions] = useState<PlanningSession[]>([]);
  const [planningSidebarActiveId, setPlanningSidebarActiveId] = useState<string | null>(
    null,
  );
  const [openPlanningMainTabIds, setOpenPlanningMainTabIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [docsSidebarExpanded, setDocsSidebarExpanded] = useState(false);
  const [planningDocFiles, setPlanningDocFiles] = useState<PlanningDocFileEntry[]>([]);
  const [planningDocsCloudListMeta, setPlanningDocsCloudListMeta] =
    useState<PlanningDocsCloudListMeta | null>(null);
  const [planningDocsListLoading, setPlanningDocsListLoading] = useState(false);
  const [planningDocsListError, setPlanningDocsListError] = useState<string | null>(
    null,
  );
  const [selectedPlanningDocPath, setSelectedPlanningDocPath] = useState<
    string | null
  >(null);
  const [planningDocFileRevision, setPlanningDocFileRevision] = useState(0);
  const planningDocsDirtyRef = useRef(false);
  /** Bumped when `project` changes so in-flight tab restore cannot unlock persistence for a newer project. */
  const tabRestoreGenerationRef = useRef(0);
  /** False until the current project's async tab restore finishes (avoids empty defaults overwriting disk on startup). */
  const tabsPersistAllowedRef = useRef(false);
  /** Bumps when restore completes so the persist effect re-evaluates `tabsPersistAllowedRef`. */
  const [tabPersistNonce, setTabPersistNonce] = useState(0);
  const boardRowRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const openTabIdsRef = useRef(openTabIds);
  openTabIdsRef.current = openTabIds;
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;
  const uidRef = useRef<string | null>(null);
  const cloudUnblockTasksPrevRef = useRef<Task[] | null>(null);
  const cloudUnblockInFlightRef = useRef<Set<string>>(new Set());
  /** Skips duplicate unblock handling in the cloud snapshot effect while we finalize Done inline. */
  const cloudInlineDoneFollowUpTaskIdsRef = useRef<Set<string>>(new Set());
  const createPrInflightTaskIdRef = useRef<string | null>(null);
  /** Task ids that already received `tasks:requestPullRequestFromAgent` without a linked PR yet. */
  const prAgentPromptSentTaskIdsRef = useRef<Set<string>>(new Set());
  const prAgentFollowupTimersByTaskIdRef = useRef<Map<string, number[]>>(new Map());
  /** Cancels in-flight bounded discovery when bumped per task id. */
  const taskPrDiscoveryGenRef = useRef<Map<string, number>>(new Map());
  const [prAgentAwaitingByTaskId, setPrAgentAwaitingByTaskId] = useState<Record<string, boolean>>({});
  const runDiscoverGithubPrForTaskRef = useRef<
    | ((
        taskId: string,
        context: GithubPrDiscoveryMessageContext,
        opts?: { suppressBenignErrors?: boolean },
      ) => Promise<boolean>)
    | null
  >(null);
  const pendingAgentPrDiscoveryLastAtRef = useRef<Map<string, number>>(new Map());
  const worktreeResolveGenRef = useRef(0);
  const memberPhotoRefreshKeyRef = useRef('');
  const projectReposLoadSeqRef = useRef(0);
  const [autoStartWhenUnblockedProject, setAutoStartWhenUnblockedProject] = useState(false);
  const [repoDefaultBranchShort, setRepoDefaultBranchShort] = useState('main');
  /** Loaded for task UI (repo picker + labels). Null while loading. */
  const [projectRepos, setProjectRepos] = useState<RepoConfig[] | null>(null);
  /** Cloud multi-repo: local clone path/status per shared repo id for board tooltips. */
  const [cloudRepoBindingOverview, setCloudRepoBindingOverview] =
    useState<CloudRepoBindingOverview | null>(null);

  const auth = useAuth();
  const uid = auth.user?.uid ?? null;
  uidRef.current = uid;
  const userEmail = auth.user?.email ?? null;
  const displayName = auth.user?.displayName ?? undefined;
  const userPhotoURL = auth.user?.photoURL ?? undefined;
  const cloudProjectsState = useCloudProjects(uid);
  const invitesState = useInvites(userEmail);

  useEffect(() => {
    if (!uid || !auth.user || cloudProjectsState.status !== 'ready') return;
    const ids = cloudProjectsState.projects
      .map((p) => p.id)
      .slice()
      .sort()
      .join(',');
    const key = `${auth.user.photoURL ?? ''}|${ids}`;
    if (key === memberPhotoRefreshKeyRef.current) return;
    memberPhotoRefreshKeyRef.current = key;
    void mergeMemberPhotoURL(
      uid,
      auth.user.photoURL ?? null,
      cloudProjectsState.projects.map((p) => p.id),
    ).catch((err) => console.error('[mergeMemberPhotoURL] failed', err));
  }, [uid, auth.user, cloudProjectsState.status, cloudProjectsState.projects]);

  const cloudProjectId = project?.kind === 'cloud' ? project.id : null;
  const runners = useRunners(cloudProjectId);

  const cloudSharedRepoIdsKey = useMemo(() => {
    if (project?.kind !== 'cloud') return '';
    return project.sharedRepos.map((s) => s.id).join(',');
  }, [project]);

  useEffect(() => {
    if (!project) {
      setRepoDefaultBranchShort('main');
      return;
    }
    let cancelled = false;
    void window.electronAPI.repo.getBranchDiscovery().then((r) => {
      if (cancelled) return;
      if ('error' in r) {
        const fallback =
          project.kind === 'local' && project.repos[0]?.baseBranch?.trim()
            ? project.repos[0].baseBranch.trim()
            : 'main';
        setRepoDefaultBranchShort(fallback);
        return;
      }
      setRepoDefaultBranchShort(r.defaultBranchShort);
    });
    return () => {
      cancelled = true;
    };
  }, [project?.id, project?.rootPath, project?.kind]);

  const refreshProjectRepos = useCallback(async (): Promise<RepoConfig[]> => {
    const seq = ++projectReposLoadSeqRef.current;
    if (!project) {
      setProjectRepos(null);
      return [];
    }
    try {
      const repos = await window.electronAPI.project.getRepos();
      if (seq === projectReposLoadSeqRef.current) setProjectRepos(repos);
      return repos;
    } catch (err) {
      console.warn('[App] project.getRepos failed', err);
      const fallback = project.kind === 'local' ? project.repos : [];
      if (seq === projectReposLoadSeqRef.current) setProjectRepos(fallback);
      return fallback;
    }
  }, [project]);

  useEffect(() => {
    void refreshProjectRepos();
    return () => {
      projectReposLoadSeqRef.current += 1;
    };
  }, [refreshProjectRepos]);

  useEffect(() => {
    if (
      !project ||
      project.kind !== 'cloud'
    ) {
      setCloudRepoBindingOverview(null);
      return;
    }
    if (project.sharedRepos.length <= 1) {
      setCloudRepoBindingOverview(null);
      return;
    }
    let cancelled = false;
    void window.electronAPI.project
      .getCloudRepoBindingOverview(project.sharedRepos)
      .then((r) => {
        if (cancelled) return;
        if (r && typeof r === 'object' && 'error' in r) {
          setCloudRepoBindingOverview(null);
          return;
        }
        setCloudRepoBindingOverview(r as CloudRepoBindingOverview);
      })
      .catch(() => {
        if (!cancelled) setCloudRepoBindingOverview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id, project?.kind, cloudSharedRepoIdsKey]);

  const membersState = useMembers(cloudProjectId);
  const { cloudPlanningDocsSeedModal } = useCloudPlanningDocsMigration(
    project?.kind === 'cloud' ? project : null,
    uid,
  );
  useAgentHeartbeat({
    projectId: cloudProjectId,
    uid,
    displayName,
    photoURL: userPhotoURL,
  });
  const projectMembers = cloudProjectId ? membersState.members : undefined;

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const projectHashRoute = useProjectHashRoute();
  const settingsRouteActive = projectHashRoute === 'settings';

  const refreshPlanningSessions = useCallback(async () => {
    const api = window.electronAPI.planning;
    if (!api?.list) return;
    try {
      const list = await api.list();
      setPlanningSessions(list);
    } catch (err) {
      console.error('[App] planning.list failed', err);
    }
  }, []);

  const refreshPlanningRelatedProjectState = useCallback(async () => {
    if (!project) return;
    if (project.kind === 'local') {
      const p = await window.electronAPI.project.get();
      if (p) setProject(p);
      return;
    }
    const binding = await window.electronAPI.projects.getLocalBinding(project.id);
    if (!binding) return;
    setProject((cur) =>
      cur && cur.kind === 'cloud' && cur.id === project.id
        ? hydrateCloudProject(
            {
              id: cur.id,
              name: cur.name,
              ownerId: cur.ownerId,
              memberIds: cur.memberIds,
              createdAt: cur.createdAt,
              repos: cur.sharedRepos,
            },
            binding,
          )
        : cur,
    );
  }, [project]);

  const refreshPlanningDocList = useCallback(async () => {
    const api = window.electronAPI.planningDocs;
    setPlanningDocsListLoading(true);
    setPlanningDocsListError(null);
    try {
      const result = await api.list();
      if ('error' in result) {
        setPlanningDocFiles([]);
        setPlanningDocsCloudListMeta(null);
        setPlanningDocsListError(
          result.error === 'NO_PROJECT'
            ? project?.kind === 'cloud'
              ? 'No planning folder for this workspace. Ensure the linked repository is available on disk.'
              : 'No workspace open.'
            : 'Could not read the planning folder.',
        );
        return;
      }
      setPlanningDocFiles(result.files);
      setPlanningDocsCloudListMeta(result.cloudListMeta ?? null);
    } catch {
      setPlanningDocFiles([]);
      setPlanningDocsCloudListMeta(null);
      setPlanningDocsListError('Failed to load documents.');
    } finally {
      setPlanningDocsListLoading(false);
    }
  }, [project?.kind]);

  const shouldLoadPlanningDocs = docsSidebarExpanded || activeTabId === 'docs';

  useEffect(() => {
    if (!project || !shouldLoadPlanningDocs) return;
    void refreshPlanningDocList();
  }, [project?.id, shouldLoadPlanningDocs, refreshPlanningDocList]);

  useEffect(() => {
    if (activeTabId !== 'docs') return;
    if (selectedPlanningDocPath != null) return;
    if (planningDocFiles.length > 0) {
      setSelectedPlanningDocPath(planningDocFiles[0].relativePath);
    }
  }, [activeTabId, selectedPlanningDocPath, planningDocFiles]);

  useEffect(() => {
    if (selectedPlanningDocPath == null) return;
    if (planningDocsListLoading) return;
    if (planningDocFiles.length === 0) {
      setSelectedPlanningDocPath(null);
      return;
    }
    if (!planningDocFiles.some((f) => f.relativePath === selectedPlanningDocPath)) {
      setSelectedPlanningDocPath(planningDocFiles[0]?.relativePath ?? null);
    }
  }, [planningDocFiles, selectedPlanningDocPath, planningDocsListLoading]);

  useEffect(() => {
    if (!project) return;
    if (!docsSidebarExpanded && activeTabId !== 'docs') return;
    const unsub = window.electronAPI.planningDocs.onChanged(() => {
      void refreshPlanningDocList();
      if (activeTabId === 'docs') {
        setPlanningDocFileRevision((n) => n + 1);
      }
    });
    return unsub;
  }, [
    project?.id,
    docsSidebarExpanded,
    activeTabId,
    refreshPlanningDocList,
  ]);

  // Stable ref for cloud sharedRepos + membership checks (avoid stale closures).
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // ----- Task provider per active project -----
  const provider = useMemo<TaskProvider | null>(() => {
    if (!project) return null;
    if (project.kind === 'local') return new LocalTaskProvider();
    if (!uid) return null;
    return new FirestoreTaskProvider(project.id, uid, () => {
      const p = projectRef.current;
      return p?.kind === 'cloud' ? p.sharedRepos : [];
    });
  }, [project?.kind, project?.id, uid]);

  useEffect(() => {
    if (!provider) {
      setTasks([]);
      return;
    }
    const unsub = provider.subscribe((all) => setTasks(all));
    return () => unsub();
  }, [provider]);

  const planningDocsFirestoreStream = usePlanningDocsFirestoreSync({
    enabled: project?.kind === 'cloud' && !!uid && isFirebaseConfigured(),
    projectId: project?.kind === 'cloud' ? project.id : null,
  });

  usePlanningDocsFirestorePush({
    enabled: project?.kind === 'cloud' && !!uid && isFirebaseConfigured(),
    projectId: project?.kind === 'cloud' ? project.id : null,
    uid,
  });

  useEffect(() => {
    if (!project) {
      setAutoStartWhenUnblockedProject(false);
      return;
    }
    let cancelled = false;
    void window.electronAPI.project
      .getAutoStartWhenUnblocked()
      .then((v) => {
        if (!cancelled) setAutoStartWhenUnblockedProject(v);
      })
      .catch(() => {
        if (!cancelled) setAutoStartWhenUnblockedProject(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  useEffect(() => {
    if (project?.kind !== 'cloud' || !provider) {
      cloudUnblockTasksPrevRef.current = null;
      return;
    }
    const prev = cloudUnblockTasksPrevRef.current;
    cloudUnblockTasksPrevRef.current = tasks;
    if (prev == null) {
      return;
    }
    const prevById = new Map(prev.map((t) => [t.id, t]));
    for (const t of tasks) {
      const was = prevById.get(t.id);
      if (!was || was.status === 'done' || t.status !== 'done') {
        continue;
      }
      if (cloudInlineDoneFollowUpTaskIdsRef.current.has(t.id)) {
        continue;
      }
      const allAfter = tasks;
      const allBefore = allAfter.map((x) => (x.id === t.id ? was : x));
      void (async () => {
        if (!provider) {
          return;
        }
        let inProg = false;
        let whenUnb = false;
        try {
          [inProg, whenUnb] = await Promise.all([
            window.electronAPI.project.getAutoStartSessionOnInProgress(),
            window.electronAPI.project.getAutoStartWhenUnblocked(),
          ]);
        } catch {
          return;
        }
        const policy: UnblockAutostartPolicy = {
          autoStartSessionOnInProgress: inProg,
          autoStartWhenUnblocked: whenUnb,
        };
        await applyUnblockAutostartForCompletedBlocker(was, t, allBefore, allAfter, policy, {
          inFlight: cloudUnblockInFlightRef.current,
          source: 'cloud:tasks',
          logError: (msg, data) => console.error(msg, data),
          getCurrentList: () => tasksRef.current,
          cloudUnblockAutostartClientUid: uidRef.current ?? null,
          startSession: (task, all) =>
            window.electronAPI.sessions.start(task, all, uidRef.current ?? undefined),
          moveBacklogToInProgress: async (id) => {
            const task = tasksRef.current.find((x) => x.id === id);
            const patch: TaskPatch = { status: 'in-progress' };
            if (uidRef.current && !task?.assigneeId) patch.assigneeId = uidRef.current;
            const updated = await provider.update(id, patch);
            if (inProg) {
              const all = tasksRef.current.map((x) => (x.id === id ? updated : x));
              const r = await window.electronAPI.sessions.start(
                updated,
                all,
                uidRef.current ?? undefined,
              );
              if (r && typeof r === 'object' && 'error' in r) {
                console.error('[task:unblock-autostart] session start failed', {
                  taskId: id,
                  error: (r as { error: string }).error,
                });
              }
            }
          },
          moveBacklogToInProgressThenStartSessionWithoutImplicitInProg: async (id) => {
            const task = tasksRef.current.find((x) => x.id === id);
            const patch: TaskPatch = { status: 'in-progress' };
            if (uidRef.current && !task?.assigneeId) patch.assigneeId = uidRef.current;
            const updated = await provider.update(id, patch);
            const all = tasksRef.current.map((x) => (x.id === id ? updated : x));
            const r = await window.electronAPI.sessions.start(
              updated,
              all,
              uidRef.current ?? undefined,
            );
            if (r && typeof r === 'object' && 'error' in r) {
              console.error('[task:unblock-autostart] session start failed', {
                taskId: id,
                error: (r as { error: string }).error,
              });
            }
          },
        });
      })();
    }
  }, [tasks, project?.kind, project?.id, provider]);

  useEffect(() => {
    if (!provider?.reloadFromMain) return;
    const reload = provider.reloadFromMain;
    const unsub = window.electronAPI.tasks.onChanged(() => {
      void reload().catch((err) => {
        console.error('[tasks.onChanged] reloadFromMain failed', err);
      });
    });
    return unsub;
  }, [provider]);

  const tasksWorktreeIdsKey = useMemo(
    () =>
      tasks
        .map((t) => `${t.id}\t${t.repoId ?? ''}\t${t.fluxWorkBranch ?? ''}`)
        .sort()
        .join('\0'),
    [tasks],
  );

  const sessionsWorktreeKey = useMemo(
    () =>
      sessions
        .map((s) => `${s.taskId}\t${s.worktreePath ?? ''}\t${s.status}`)
        .sort()
        .join('|'),
    [sessions],
  );

  useEffect(() => {
    if (!project) {
      setTaskHasWorktreeById({});
      return;
    }
    const api = window.electronAPI.tasks;
    if (typeof api.resolveWorktrees !== 'function') {
      setTaskHasWorktreeById({});
      return;
    }
    if (tasksRef.current.length === 0) {
      setTaskHasWorktreeById({});
      return;
    }
    const gen = ++worktreeResolveGenRef.current;
    const handle = window.setTimeout(() => {
      void api
        .resolveWorktrees(
          tasksRef.current.map((t) => ({
            taskId: t.id,
            repoId: t.repoId,
            fluxWorkBranch: t.fluxWorkBranch,
          })),
        )
        .then((map) => {
          if (worktreeResolveGenRef.current !== gen) return;
          setTaskHasWorktreeById(map);
        })
        .catch((err) => {
          console.warn('[tasks.resolveWorktrees]', err);
        });
    }, 320);
    return () => {
      worktreeResolveGenRef.current += 1;
      window.clearTimeout(handle);
    };
  }, [project?.id, tasksWorktreeIdsKey, sessionsWorktreeKey]);

  // ----- Initial active-project hydration -----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const key = await window.electronAPI.projects.getActiveKey();
      if (cancelled) return;
      if (!key) {
        setActivationLoading(false);
        return;
      }
      if (key.kind === 'local') {
        const list = await window.electronAPI.projects.listLocal();
        const local = list.find((p) => p.id === key.id) ?? null;
        if (cancelled) return;
        setProject(local);
        setActivationLoading(false);
        return;
      }
      // Cloud: wait for auth + Firestore snapshot in the effect below.
      setPendingCloudActive(key.id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve a pending cloud active once auth + Firestore have loaded.
  useEffect(() => {
    if (!pendingCloudActive) return;
    if (auth.status === 'loading') return;
    let cancelled = false;
    void (async () => {
      if (auth.status !== 'signedIn') {
        await window.electronAPI.projects.clearActive();
        if (!cancelled) {
          setPendingCloudActive(null);
          setActivationLoading(false);
        }
        return;
      }
      if (cloudProjectsState.status !== 'ready') return;
      const match = cloudProjectsState.projects.find(
        (p) => p.id === pendingCloudActive,
      );
      if (!match) {
        await window.electronAPI.projects.clearActive();
        if (!cancelled) {
          setPendingCloudActive(null);
          setActivationLoading(false);
        }
        return;
      }
      const binding = await window.electronAPI.projects.getLocalBinding(match.id);
      if (!binding) {
        await window.electronAPI.projects.clearActive();
        if (!cancelled) {
          setPendingCloudActive(null);
          setActivationLoading(false);
        }
        return;
      }
      const primaryPath = primaryRootPathFromCloudBinding(
        match.id,
        binding,
        match.repos,
      );
      if (!primaryPath) {
        await window.electronAPI.projects.clearActive();
        if (!cancelled) {
          setPendingCloudActive(null);
          setActivationLoading(false);
        }
        return;
      }
      const result = await window.electronAPI.projects.activateCloud({
        id: match.id,
        rootPath: primaryPath,
        ...(match.repos?.length
          ? { sharedRepos: match.repos }
          : {}),
      });
      if (cancelled) return;
      if (!result || 'error' in result) {
        await window.electronAPI.projects.clearLocalBinding(match.id);
        await window.electronAPI.projects.clearActive();
        setPendingCloudActive(null);
        setActivationLoading(false);
        return;
      }
      setProject(hydrateCloudProject(match, binding));
      setPendingCloudActive(null);
      setActivationLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    pendingCloudActive,
    auth.status,
    cloudProjectsState.status,
    cloudProjectsState.projects,
  ]);

  // Multi-repo2 cloud: keep ~/.flux/projects/<cloudId>/ workspace `repos[]` aligned with shared repo ids + bindings.
  useEffect(() => {
    if (!project || project.kind !== 'cloud') return;
    if (project.sharedRepos.length === 0) return;
    let cancelled = false;
    void window.electronAPI.project
      .syncCloudSharedRepos(project.sharedRepos)
      .then((result) => {
        if (cancelled) return;
        if ('error' in result) {
          console.warn('[App] syncCloudSharedRepos failed', result.error);
          return;
        }
        void refreshProjectRepos();
      })
      .catch((err) => {
        console.warn('[App] syncCloudSharedRepos', err);
      });
    return () => {
      cancelled = true;
    };
  }, [
    project?.id,
    project?.kind,
    project?.kind === 'cloud' ? project.sharedRepos : undefined,
    refreshProjectRepos,
  ]);

  // Keep cloud project's Firestore-side fields fresh when the snapshot updates.
  useEffect(() => {
    if (!project || project.kind !== 'cloud') return;
    if (cloudProjectsState.status !== 'ready') return;
    const fresh = cloudProjectsState.projects.find((p) => p.id === project.id);
    if (!fresh) return;
    const reposChanged =
      fresh.repos !== undefined &&
      JSON.stringify(fresh.repos) !== JSON.stringify(project.sharedRepos);
    const changed =
      fresh.name !== project.name ||
      fresh.ownerId !== project.ownerId ||
      fresh.memberIds.join(',') !== project.memberIds.join(',') ||
      fresh.createdAt !== project.createdAt ||
      reposChanged;
    if (!changed) return;
    setProject({
      ...project,
      name: fresh.name,
      ownerId: fresh.ownerId,
      memberIds: fresh.memberIds,
      createdAt: fresh.createdAt,
      ...(fresh.repos !== undefined ? { sharedRepos: fresh.repos } : {}),
    });
  }, [project, cloudProjectsState.status, cloudProjectsState.projects]);

  useEffect(() => {
    const unsub = window.electronAPI.sessions.onExit((exited) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === exited.id ? { ...s, status: exited.status } : s)),
      );

      // Cloud projects: clean exit (code 0 → 'stopped') moves task to needs-input.
      if (exited.status !== 'stopped' || !exited.taskId) {
        if (exited.status === 'error' && exited.taskId) {
          console.warn('[task:status] agent exited with error, not transitioning task (cloud)', {
            taskId: exited.taskId,
            sessionId: exited.id,
          });
        }
        return;
      }

      if (projectRef.current?.kind !== 'cloud') return;

      const task = tasksRef.current.find((t) => t.id === exited.taskId);
      if (!task || task.status !== 'in-progress') {
        if (task) {
          console.log('[task:status] session exit skip: task not in-progress', {
            taskId: exited.taskId,
            status: task.status,
          });
        }
        return;
      }

      const currentUid = uidRef.current;
      if (!currentUid || task.assigneeId !== currentUid) {
        console.log('[task:status] session exit skip: assignee mismatch', {
          taskId: exited.taskId,
          assigneeId: task.assigneeId,
          currentUid,
        });
        return;
      }

      console.log('[task:status] in-progress → needs-input (agent exited cleanly, cloud)', {
        taskId: exited.taskId,
        assigneeId: task.assigneeId,
      });
      setTasks((prev) =>
        prev.map((t) => (t.id === exited.taskId ? { ...t, status: 'needs-input' } : t)),
      );
      void providerRef.current
        ?.update(exited.taskId, { status: 'needs-input' })
        .catch((err) => {
          console.error('[task:status] Firestore write failed (needs-input, exit)', {
            taskId: exited.taskId,
            err,
          });
        });
    });
    return () => unsub();
  }, []);

  // Stable refs so agent-state callbacks always see the latest values without
  // needing to be torn down and recreated when project/provider changes.
  const providerRef = useRef(provider);
  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  useCloudSilenceReconciliation({
    enabled: project?.kind === 'cloud',
    projectId: project?.id,
    sessions,
    tasksRef,
    uidRef,
    providerRef,
    setTasks,
  });

  // Silence-based needs-input detection: subscribe to agent-state for running sessions.
  // Subscriptions are managed incrementally to avoid a teardown+recreate gap on every
  // sessions state change (which would allow events to be silently dropped).
  const agentStateUnsubsRef = useRef<Map<string, () => void>>(new Map());
  useEffect(() => {
    const runningIds = new Set(
      sessions.filter((s) => s.status === 'running').map((s) => s.id),
    );

    // Remove subscriptions for sessions that are no longer running.
    for (const [id, unsub] of [...agentStateUnsubsRef.current.entries()]) {
      if (!runningIds.has(id)) {
        unsub();
        agentStateUnsubsRef.current.delete(id);
      }
    }

    // Add subscriptions for newly running sessions.
    for (const s of sessions) {
      if (s.status !== 'running' || agentStateUnsubsRef.current.has(s.id) || !s.taskId) continue;
      const { id, taskId } = s;
      const unsub = window.electronAPI.sessions.onAgentState(id, (state) => {
        // Only silence triggers an automatic status change here. The
        // needs-input → in-progress transition is driven exclusively by the
        // user sending a message (session:write); see the task:userInput
        // listener below.
        if (state !== 'silent') return;

        if (prAgentPromptSentTaskIdsRef.current.has(taskId)) {
          const row = tasksRef.current.find((x) => x.id === taskId);
          if (!row?.githubPr?.url?.trim()) {
            void runDiscoverGithubPrForTaskRef
              .current?.(taskId, 'pending-agent', {
                suppressBenignErrors: true,
              })
              .catch((err) => {
                console.warn('[github-pr] silence discovery failed', taskId, err);
              });
          }
        }

        // Cloud-only feature for now.
        if (projectRef.current?.kind !== 'cloud') {
          return;
        }

        const task = tasksRef.current.find((t) => t.id === taskId);
        if (!task || task.status !== 'in-progress') {
          if (task) {
            console.log('[task:status] silence skip: task not in-progress', {
              taskId,
              status: task.status,
            });
          } else {
            console.log('[task:status] silence skip: task not found', { taskId });
          }
          return;
        }

        // Only the assignee may mutate task status.
        const currentUid = uidRef.current;
        if (!currentUid || task.assigneeId !== currentUid) {
          console.log('[task:status] silence skip: assignee mismatch', {
            taskId,
            assigneeId: task.assigneeId,
            currentUid,
          });
          return;
        }

        console.log('[task:status] in-progress → needs-input (silence detected)', {
          taskId,
          assigneeId: task.assigneeId,
        });
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: 'needs-input' } : t)),
        );
        void providerRef.current
          ?.update(taskId, { status: 'needs-input' })
          .catch((err) => {
            console.error('[task:status] Firestore write failed (needs-input)', { taskId, err });
          });
      });
      agentStateUnsubsRef.current.set(id, unsub);
    }
  }, [sessions]);

  // Clean up all agent-state subscriptions on unmount.
  useEffect(() => {
    return () => {
      for (const unsub of agentStateUnsubsRef.current.values()) unsub();
    };
  }, []);

  // Cloud projects: transition needs-input or review → in-progress when the user submits
  // a query. SENDING A QUERY IS THE ONLY WAY TO BREAK SILENCE.
  useEffect(() => {
    if (project?.kind !== 'cloud') return;
    return window.electronAPI.tasks.onUserInput(({ taskId }) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task || (task.status !== 'needs-input' && task.status !== 'review')) return;

      const currentUid = uidRef.current;
      if (!currentUid || task.assigneeId !== currentUid) return;

      console.log('[task:status] needs-input/review → in-progress (user submitted query)', {
        taskId,
        assigneeId: task.assigneeId,
        from: task.status,
      });
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: 'in-progress' } : t)),
      );
      void providerRef.current
        ?.update(taskId, { status: 'in-progress' })
        .catch((err) => {
          console.error('[task:status] Firestore write failed (in-progress)', { taskId, err });
        });
    });
  }, [project?.kind]);

  useEffect(() => {
    if (project?.kind !== 'cloud') return;
    return window.electronAPI.tasks.onPersistFluxWorkBranch(({ taskId, fluxWorkBranch }) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, fluxWorkBranch } : t)),
      );
      void providerRef.current?.update(taskId, { fluxWorkBranch }).catch((err) => {
        console.error('[task:fluxWorkBranch] Firestore write failed', { taskId, err });
      });
    });
  }, [project?.kind]);

  useEffect(() => {
    setSessionStartPendingTaskIds(new Set());
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;
    return window.electronAPI.sessions.onTaskStartProgress((p) => {
      if (p.phase === 'starting') {
        setSessionStartPendingTaskIds((prev) => {
          const next = new Set(prev);
          next.add(p.taskId);
          return next;
        });
        return;
      }
      setSessionStartPendingTaskIds((prev) => {
        if (!prev.has(p.taskId)) return prev;
        const next = new Set(prev);
        next.delete(p.taskId);
        return next;
      });
      if ('error' in p.outcome) return;
      const s = p.outcome;
      if (s.projectId !== project.id) return;

      // Replacing a session for the same task (e.g. Resume / New session) creates a new
      // daemon id. Drop prior rows for this taskId and migrate tab strip + focus so we
      // do not open a duplicate workspace tab or leave the active tab pointing at a dead id.
      const replacedIds = sessionsRef.current
        .filter((x) => x.taskId === s.taskId)
        .map((x) => x.id);
      for (const id of replacedIds) {
        if (id !== s.id) invalidateSessionAttachCache(id);
      }

      setMinimizedWorkspaceIds((prev) => {
        if (replacedIds.length === 0) return prev;
        const next = new Set(prev);
        for (const id of replacedIds) next.delete(id);
        return next;
      });

      setSessions((prev) => {
        const withoutTask = prev.filter((x) => x.taskId !== s.taskId);
        const i = withoutTask.findIndex((x) => x.id === s.id);
        if (i >= 0) {
          const next = withoutTask.slice();
          next[i] = s;
          return next;
        }
        return [...withoutTask, s];
      });

      const hadOpenReplaced = replacedIds.some((id) => openTabIdsRef.current.has(id));
      if (hadOpenReplaced) {
        setOpenTabIds((prev) => {
          const next = new Set(prev);
          for (const id of replacedIds) {
            next.delete(id);
          }
          next.add(s.id);
          return next;
        });
        setActiveTabId((prev) => (replacedIds.includes(prev) ? s.id : prev));
      }
    });
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;
    void refreshPlanningSessions();
  }, [project?.id, refreshPlanningSessions]);

  useEffect(() => {
    const api = window.electronAPI.planning;
    if (!api?.onExit) return;
    return api.onExit(() => {
      void refreshPlanningSessions();
    });
  }, [refreshPlanningSessions]);

  useEffect(() => {
    const sid = parsePlanTabId(activeTabId);
    if (!sid) return;
    if (planningSessions.length === 0) return;
    if (!planningSessions.some((s) => s.id === sid)) {
      setActiveTabId('board');
    }
  }, [activeTabId, planningSessions]);

  useEffect(() => {
    if (planningSessions.length === 0) return;
    setOpenPlanningMainTabIds((prev) => {
      const alive = new Set(planningSessions.map((s) => s.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size && [...prev].every((x) => next.has(x)) ? prev : next;
    });
  }, [planningSessions]);

  useEffect(() => {
    if (!planningSidebarActiveId) return;
    if (planningSessions.some((s) => s.id === planningSidebarActiveId)) return;
    setPlanningSidebarActiveId(planningSessions[0]?.id ?? null);
  }, [planningSessions, planningSidebarActiveId]);

  useEffect(() => {
    if (!project) {
      tabRestoreGenerationRef.current += 1;
      tabsPersistAllowedRef.current = false;
      setSessions([]);
      setSessionStartPendingTaskIds(new Set());
      setOpenTabIds(new Set());
      setMinimizedWorkspaceIds(new Set());
      setActiveTabId('board');
      setPlanningSessions([]);
      setPlanningSidebarActiveId(null);
      setOpenPlanningMainTabIds(new Set());
      setPlanningSidebarOpen(false);
      setPlanPanelOpen(false);
      return;
    }
    tabRestoreGenerationRef.current += 1;
    const restoreGen = tabRestoreGenerationRef.current;
    tabsPersistAllowedRef.current = false;

    // Clear strip state immediately so we never persist another project's tabs under
    // this project key while the daemon + disk restore is in flight.
    setOpenTabIds(new Set());
    setOpenPlanningMainTabIds(new Set());
    setPlanningSidebarActiveId(null);
    setPlanningSidebarOpen(false);
    setMinimizedWorkspaceIds(new Set());

    setSessions((prev) => prev.filter((s) => s.projectId === project.id));
    setActiveTabId((prev) => {
      if (prev === 'settings') return 'board';
      return STATIC_TAB_IDS.has(prev) ? prev : 'board';
    });

    // Hydrate live sessions from the daemon and restore the persisted tab
    // strip — the whole point of Milestone A session continuity. The
    // terminals inside each pane fetch their own replay buffers on
    // mount via `sessions.attach(id)`.
    let cancelled = false;
    const projectKey: ActiveProjectKey = { kind: project.kind, id: project.id };
    void (async () => {
      try {
        const all = await window.electronAPI.sessions.getAll();
        if (cancelled) return;
        const projectSessions = all.filter((s) => s.projectId === project.id);
        setSessions(projectSessions);

        // Cloud startup catchup: the main process cannot write to Firestore, so
        // the renderer must reconcile task status against the daemon's current
        // silence state on every load.  For local projects applyAgentState in the
        // main process handles this before the window even opens, so we skip it.
        if (project.kind === 'cloud') {
          void (async () => {
            try {
              // Wait up to 5 s for the Firestore provider to emit its first
              // non-empty batch for this project (it's async). Silence state is
              // fetched inside reconcileCloudSilenceFromDaemon.
              const initialTasks = await new Promise<Task[]>((resolve) => {
                const currentProvider = providerRef.current;
                if (!currentProvider) {
                  resolve([]);
                  return;
                }
                const timeout = setTimeout(() => {
                  unsub();
                  resolve([]);
                }, 5_000);
                const unsub = currentProvider.subscribe((all) => {
                  const mine = all.filter((t) => t.projectId === project.id);
                  if (mine.length > 0) {
                    clearTimeout(timeout);
                    unsub();
                    resolve(mine);
                  }
                });
              });

              const currentProvider = providerRef.current;
              if (!currentProvider || cancelled) return;

              await reconcileCloudSilenceFromDaemon({
                projectId: project.id,
                sessions: projectSessions,
                tasks: initialTasks,
                uid: uidRef.current,
                provider: currentProvider,
                setTasks,
                source: 'startup-catchup',
              });
            } catch (err) {
              console.warn('[task:status] startup cloud silence catchup failed', err);
            }
          })();
        }

        const persisted = await window.electronAPI.projects.getTabs(projectKey);
        if (cancelled) return;
        const aliveIds = new Set(projectSessions.map((s) => s.id));
        const normalized = normalizeRestoredProjectTabState(persisted, aliveIds);
        setOpenTabIds(new Set(normalized.openTaskIds));
        setMinimizedWorkspaceIds(new Set(normalized.minimizedTaskWorkspaceIds));
        setOpenPlanningMainTabIds(new Set(normalized.openPlanningTabIds));
        setPlanningSidebarActiveId(normalized.planningSidebarActiveSessionId);
        setPlanningSidebarOpen(normalized.planningSidebarOpen);
        if (normalized.openSettingsRoute) {
          setActiveTabId('board');
          pushProjectSettingsRoute();
        } else {
          setActiveTabId(normalized.activeTabId);
        }
      } catch (err) {
        console.error('[App] restore tabs failed', err);
      } finally {
        if (!cancelled && tabRestoreGenerationRef.current === restoreGen) {
          tabsPersistAllowedRef.current = true;
          setTabPersistNonce((n) => n + 1);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id, project?.kind]);

  // Persist tab strip whenever it changes for the active project.
  useEffect(() => {
    if (!project) return;
    if (!tabsPersistAllowedRef.current) return;
    const projectKey: ActiveProjectKey = { kind: project.kind, id: project.id };
    const tabs: ProjectTabState = {
      openTaskIds: Array.from(openTabIds),
      activeTaskId: activeTabId,
      openPlanningTabIds: Array.from(openPlanningMainTabIds),
      planningSidebarActiveSessionId: planningSidebarActiveId,
      planningSidebarOpen,
      minimizedTaskWorkspaceIds: Array.from(minimizedWorkspaceIds),
    };
    void window.electronAPI.projects
      .setTabs(projectKey, tabs)
      .catch((err) => {
        console.error('[App] persist tabs failed', err);
      });
  }, [
    project?.id,
    project?.kind,
    openTabIds,
    activeTabId,
    openPlanningMainTabIds,
    planningSidebarActiveId,
    planningSidebarOpen,
    minimizedWorkspaceIds,
    tabPersistNonce,
  ]);

  useEffect(() => {
    const onBoardWorkspace = activeTabId === 'board' && !settingsRouteActive;
    if (!onBoardWorkspace) {
      setPlanPanelOpen(false);
      return;
    }
    if (!planningSidebarOpen) {
      setPlanPanelOpen(false);
      return;
    }
    // Match pre-persist behavior: user can open the strip before any planning session exists;
    // child UI handles empty / loading / remapped active session.
    setPlanPanelOpen(true);
  }, [activeTabId, settingsRouteActive, planningSidebarOpen]);

  const pendingRef = useRef<
    Map<
      string,
      {
        patch: TaskPatch;
        timer: ReturnType<typeof setTimeout>;
        /** Task snapshot before this debounced flush window (for transition detection). */
        preFlushTask: Task;
      }
    >
  >(new Map());

  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const { timer } of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const stripLocalSessionStateForTask = useCallback((taskId: string) => {
    const ids = sessionsRef.current
      .filter((s) => s.taskId === taskId)
      .map((s) => s.id);
    setSessions((prev) => prev.filter((s) => s.taskId !== taskId));
    setMinimizedWorkspaceIds((prev) => {
      const next = new Set(prev);
      for (const sid of ids) next.delete(sid);
      return next;
    });
    setOpenTabIds((prev) => {
      const next = new Set(prev);
      for (const sid of ids) next.delete(sid);
      return next;
    });
    setActiveTabId((prev) => (ids.includes(prev) ? 'board' : prev));
  }, []);

  const maybeStripSessionsAfterNewWorkspaceClean = useCallback(
    (before: Task | undefined, after: Task) => {
      if (after.workspaceCleanedAt && !before?.workspaceCleanedAt) {
        stripLocalSessionStateForTask(after.id);
      }
    },
    [stripLocalSessionStateForTask],
  );

  const handleCloudPrRefreshMergedAutoDone = useCallback(
    async ({ previous, updated }: { previous: Task; updated: Task }) => {
      if (project?.kind !== 'cloud' || !provider) return;
      if (previous.status === 'done' || updated.status !== 'done') return;
      const allAfter = tasksRef.current.map((t) => (t.id === updated.id ? updated : t));
      cloudInlineDoneFollowUpTaskIdsRef.current.add(updated.id);
      try {
        const follow = await runCloudDoneTransitionFollowUp({
          previous,
          updated,
          allAfter,
          provider,
          actorUid: uidRef.current,
          unblockInFlight: cloudUnblockInFlightRef.current,
          getTasks: () => tasksRef.current.map((t) => (t.id === updated.id ? updated : t)),
          setCleanupLoadingTaskId: (tid) => setCleanupLoadingTaskId(tid),
          onStripSessions: stripLocalSessionStateForTask,
        });
        maybeStripSessionsAfterNewWorkspaceClean(
          previous,
          follow.workspaceCleaned ? follow.task : updated,
        );
        if (follow.workspaceCleaned) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === follow.task.id ? mergeTaskRowPreserveMissing(t, follow.task) : t,
            ),
          );
        } else {
          setTasks((prev) =>
            prev.map((t) => (t.id === updated.id ? mergeTaskRowPreserveMissing(t, updated) : t)),
          );
        }
      } finally {
        cloudInlineDoneFollowUpTaskIdsRef.current.delete(updated.id);
      }
    },
    [project?.kind, provider, stripLocalSessionStateForTask, maybeStripSessionsAfterNewWorkspaceClean],
  );

  const cancelPrAgentFollowupTimersForTask = useCallback((taskId: string) => {
    const timers = prAgentFollowupTimersByTaskIdRef.current.get(taskId);
    if (!timers) return;
    for (const t of timers) window.clearTimeout(t);
    prAgentFollowupTimersByTaskIdRef.current.delete(taskId);
  }, []);

  const runDiscoverGithubPrForTask = useCallback(
    async (
      taskId: string,
      messageContext: GithubPrDiscoveryMessageContext,
      opts?: { suppressBenignErrors?: boolean },
    ): Promise<boolean> => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return false;
      const prov = providerRef.current;
      const proj = projectRef.current;
      if (!prov || !proj) return false;

      if (messageContext === 'pending-agent' && opts?.suppressBenignErrors) {
        const last = pendingAgentPrDiscoveryLastAtRef.current.get(taskId) ?? 0;
        const now = Date.now();
        if (now - last < PENDING_AGENT_PR_DISCOVERY_MIN_GAP_MS) {
          return false;
        }
        pendingAgentPrDiscoveryLastAtRef.current.set(taskId, now);
      }

      const result = await window.electronAPI.tasks.refreshPullRequest({
        taskId,
        githubPr: task.githubPr,
      });

      if (!result.ok) {
        if (opts?.suppressBenignErrors && isBenignPrDiscoveryWhileAgentWorking(result.code)) {
          return false;
        }
        if (
          opts?.suppressBenignErrors &&
          shouldStopPrAgentFollowupDiscovery(result.code, result.message)
        ) {
          cancelPrAgentFollowupTimersForTask(taskId);
          console.warn('[github-pr] discovery paused after error', taskId, result.code, result.message);
          return false;
        }
        setTaskPrError(formatGithubPrDiscoveryFailure(result, messageContext));
        return false;
      }

      await applyGithubPrRefreshFromRenderer({
        projectKind: proj.kind,
        taskId,
        live: task,
        snapshot: tasksRef.current,
        result,
        provider: prov,
        autoMarkDoneWhenPrMerged: proj.autoMarkDoneWhenPrMerged === true,
        autoMoveToReviewWhenPrOpen: proj.autoMoveToReviewWhenPrOpen === true,
        onCloudPrMergedAutoDone: handleCloudPrRefreshMergedAutoDone,
      });

      const linked = Boolean(result.githubPr.url?.trim());
      if (linked) {
        cancelPrAgentFollowupTimersForTask(taskId);
        pendingAgentPrDiscoveryLastAtRef.current.delete(taskId);
        taskPrDiscoveryGenRef.current.set(
          taskId,
          (taskPrDiscoveryGenRef.current.get(taskId) ?? 0) + 1,
        );
        prAgentPromptSentTaskIdsRef.current.delete(taskId);
        setPrAgentAwaitingByTaskId((prev) => {
          if (!prev[taskId]) return prev;
          const rest = { ...prev };
          delete rest[taskId];
          return rest;
        });
      }
      return linked;
    },
    [cancelPrAgentFollowupTimersForTask, handleCloudPrRefreshMergedAutoDone],
  );

  runDiscoverGithubPrForTaskRef.current = runDiscoverGithubPrForTask;

  const schedulePrAgentFollowupDiscovery = useCallback(
    (taskId: string) => {
      cancelPrAgentFollowupTimersForTask(taskId);
      const nextGen = (taskPrDiscoveryGenRef.current.get(taskId) ?? 0) + 1;
      taskPrDiscoveryGenRef.current.set(taskId, nextGen);
      const delays = [15_000, 30_000, 45_000, 60_000, 75_000, 90_000];
      const timers: number[] = [];
      for (const delay of delays) {
        timers.push(
          window.setTimeout(() => {
            if (taskPrDiscoveryGenRef.current.get(taskId) !== nextGen) return;
            const t = tasksRef.current.find((x) => x.id === taskId);
            if (t?.githubPr?.url?.trim()) return;
            void runDiscoverGithubPrForTask(taskId, 'pending-agent', { suppressBenignErrors: true }).catch(
              (err) => {
                console.warn('[github-pr] follow-up discovery failed', taskId, err);
              },
            );
          }, delay),
        );
      }
      prAgentFollowupTimersByTaskIdRef.current.set(taskId, timers);
    },
    [cancelPrAgentFollowupTimersForTask, runDiscoverGithubPrForTask],
  );

  useEffect(() => {
    setPrAgentAwaitingByTaskId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const taskId of Object.keys(prev)) {
        if (!prev[taskId]) continue;
        const t = tasks.find((x) => x.id === taskId);
        if (t?.githubPr?.url?.trim()) {
          delete next[taskId];
          changed = true;
          cancelPrAgentFollowupTimersForTask(taskId);
          prAgentPromptSentTaskIdsRef.current.delete(taskId);
        }
      }
      return changed ? next : prev;
    });
  }, [tasks, cancelPrAgentFollowupTimersForTask]);

  const isFullscreenPlanTab = useMemo(
    () => activeTabId === 'plan' || parsePlanTabId(activeTabId) !== null,
    [activeTabId],
  );
  const isBoardOrPlanTab = useMemo(
    () => activeTabId === 'board' || isFullscreenPlanTab,
    [activeTabId, isFullscreenPlanTab],
  );

  /** Tasks where the user asked the agent to open a PR but Flux has not linked `githubPr` yet. */
  const awaitingGithubPrLinkTaskIds = useMemo(
    () =>
      Object.entries(prAgentAwaitingByTaskId)
        .filter(([, awaiting]) => awaiting)
        .map(([taskId]) => taskId)
        .sort(),
    [prAgentAwaitingByTaskId],
  );

  useGithubPrBoardRefresh({
    projectId: project?.id,
    projectKind: project?.kind,
    provider,
    tasks,
    enabled: Boolean(project && !activationLoading && provider),
    autoMarkDoneWhenPrMerged: project?.autoMarkDoneWhenPrMerged === true,
    autoMoveToReviewWhenPrOpen: project?.autoMoveToReviewWhenPrOpen === true,
    surfaceActive: isBoardOrPlanTab,
    awaitingGithubPrLinkTaskIds,
    onCloudPrMergedAutoDone: handleCloudPrRefreshMergedAutoDone,
  });

  useRendererAutomationBridge({
    project,
    provider,
    uid,
    tasksSnapshot: tasks,
    tasksRef,
    cloudAutostartInFlightRef: cloudUnblockInFlightRef,
    cloudInlineDoneFollowUpTaskIdsRef,
    setCleanupLoadingTaskId: (tid) => setCleanupLoadingTaskId(tid),
    stripLocalSessionStateForTask,
  });

  const flushUpdate = useCallback(
    async (id: string) => {
      if (!provider) return;
      const pending = pendingRef.current.get(id);
      if (!pending) return;
      pendingRef.current.delete(id);
      const { patch, preFlushTask } = pending;
      let patchToApply = patch;
      if (
        project?.kind === 'cloud' &&
        uidRef.current &&
        patchToApply.status === 'in-progress' &&
        !preFlushTask.assigneeId
      ) {
        if (patchToApply.assigneeId === undefined) {
          patchToApply = { ...patchToApply, assigneeId: uidRef.current };
        }
      }
      patchToApply = {
        ...patchToApply,
        ...assigneePatchForCloudAutoStartOnUnblock({
          projectKind: project?.kind,
          actorUid: uidRef.current ?? undefined,
          previousAssigneeId: preFlushTask.assigneeId,
          patch: patchToApply,
        }),
      };
      const needsDoneLock =
        project?.kind === 'cloud' &&
        preFlushTask.status !== 'done' &&
        patchToApply.status === 'done';
      const execFlush = async () => {
        let localCleanupSpinnerId: string | null = null;
        if (
          project?.kind === 'local' &&
          preFlushTask.status !== 'done' &&
          patchToApply.status === 'done'
        ) {
          try {
            if (await window.electronAPI.project.getAutoCleanupWorkspaceWhenDone()) {
              localCleanupSpinnerId = id;
              setCleanupLoadingTaskId(id);
            }
          } catch {
            /* ignore */
          }
        }
        try {
          const updated = await provider.update(id, patchToApply);
          const newer = pendingRef.current.get(id);
          const mergedTask = mergeServerTaskWithPendingPatchOntoLocal(preFlushTask, updated, newer?.patch);
          let rowLocked = false;
          if (project?.kind === 'cloud') {
            const allTasksForSession = tasksRef.current.map((t) =>
              t.id === id ? mergedTask : t,
            );
            await maybeCloudAutoStartSessionOnInProgressTransition(
              preFlushTask,
              mergedTask,
              allTasksForSession,
              {
                source: 'cloud:flushUpdate',
                inFlight: cloudUnblockInFlightRef.current,
                logError: (msg, data) => console.error(msg, data),
                actorUid: uidRef.current,
              },
            );
            if (preFlushTask.status !== 'done' && mergedTask.status === 'done') {
              const follow = await runCloudDoneTransitionFollowUp({
                previous: preFlushTask,
                updated: mergedTask,
                allAfter: allTasksForSession,
                provider,
                actorUid: uidRef.current,
                unblockInFlight: cloudUnblockInFlightRef.current,
                getTasks: () => tasksRef.current,
                setCleanupLoadingTaskId: (tid) => setCleanupLoadingTaskId(tid),
                onStripSessions: stripLocalSessionStateForTask,
              });
              maybeStripSessionsAfterNewWorkspaceClean(
                preFlushTask,
                follow.workspaceCleaned ? follow.task : mergedTask,
              );
              if (follow.workspaceCleaned) {
                setTasks((prev) =>
                  prev.map((t) =>
                    t.id === follow.task.id ? mergeTaskRowPreserveMissing(t, follow.task) : t,
                  ),
                );
                rowLocked = true;
              }
            }
          } else {
            maybeStripSessionsAfterNewWorkspaceClean(preFlushTask, mergedTask);
          }
          if (!rowLocked) {
            setTasks((prev) =>
              prev.map((t) => {
                if (t.id !== id) return t;
                const localRow = t;
                return mergeServerTaskWithPendingPatchOntoLocal(localRow, updated, newer?.patch);
              }),
            );
          }
        } finally {
          if (localCleanupSpinnerId) setCleanupLoadingTaskId(null);
        }
      };
      try {
        if (needsDoneLock) {
          cloudInlineDoneFollowUpTaskIdsRef.current.add(id);
          try {
            await execFlush();
          } finally {
            cloudInlineDoneFollowUpTaskIdsRef.current.delete(id);
          }
        } else {
          await execFlush();
        }
      } catch (err) {
        console.error('[tasks.update] failed', err);
      }
    },
    [provider, project?.kind, stripLocalSessionStateForTask, maybeStripSessionsAfterNewWorkspaceClean],
  );

  const handleUpdateTask = useCallback(
    (id: string, patch: TaskPatch) => {
      const {
        autoStartOnUnblock: patchAsou,
        githubPr: patchGh,
        workspaceCleanedAt: patchWsc,
        ...patchRest
      } = patch;
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          let next: Task = { ...t, ...patchRest };
          if (patchGh !== undefined) {
            if (patchGh === null) {
              next = { ...next };
              delete next.githubPr;
            } else {
              next = { ...next, githubPr: patchGh };
            }
          }
          if (patchWsc !== undefined) {
            if (patchWsc === null) {
              next = { ...next };
              delete next.workspaceCleanedAt;
            } else {
              next = { ...next, workspaceCleanedAt: patchWsc };
            }
          }
          if (patchAsou !== undefined) {
            if (patchAsou === null) {
              next = { ...next };
              delete next.autoStartOnUnblock;
            } else {
              next = { ...next, autoStartOnUnblock: patchAsou };
            }
          }
          if (patch.labels !== undefined) {
            const n = normalizeTaskLabels(patch.labels);
            if (n.length > 0) {
              next = { ...next, labels: n };
            } else {
              next = { ...next };
              delete next.labels;
            }
          }
          if (patch.sourceBranch !== undefined) {
            if (typeof patch.sourceBranch === 'string' && patch.sourceBranch.trim() === '') {
              next = { ...next };
              delete next.sourceBranch;
            }
          }
          if (patch.createSourceBranchIfMissing !== undefined && !patch.createSourceBranchIfMissing) {
            next = { ...next };
            delete next.createSourceBranchIfMissing;
          }
          if (patch.repoId !== undefined) {
            const rid = typeof patch.repoId === 'string' ? patch.repoId.trim() : '';
            if (rid.length === 0) {
              next = { ...next };
              delete next.repoId;
            } else {
              next = { ...next, repoId: rid };
            }
          }
          next = {
            ...next,
            ...assigneePatchForCloudAutoStartOnUnblock({
              projectKind: project?.kind,
              actorUid: uid ?? undefined,
              previousAssigneeId: t.assigneeId,
              patch,
            }),
          };
          return next;
        }),
      );

      const persistable: TaskPatch = {};
      if (patch.title !== undefined) persistable.title = patch.title;
      if (patch.description !== undefined) persistable.description = patch.description;
      if (patch.status !== undefined) persistable.status = patch.status;
      if (patch.agent !== undefined) persistable.agent = patch.agent;
      if (patch.agentModel !== undefined) persistable.agentModel = patch.agentModel;
      if (patch.agentYolo !== undefined) persistable.agentYolo = patch.agentYolo;
      if (patch.orderKey !== undefined) persistable.orderKey = patch.orderKey;
      if (patch.workspaceCleanedAt !== undefined) {
        persistable.workspaceCleanedAt = patch.workspaceCleanedAt;
      }
      if (patch.blockedByTaskIds !== undefined) {
        persistable.blockedByTaskIds = patch.blockedByTaskIds;
      }
      if (patch.labels !== undefined) {
        persistable.labels = normalizeTaskLabels(patch.labels);
      }
      if (patchAsou !== undefined) {
        persistable.autoStartOnUnblock = patchAsou;
      }
      if (patch.assigneeId !== undefined) {
        persistable.assigneeId = patch.assigneeId;
      }
      if (patch.sourceBranch !== undefined) {
        persistable.sourceBranch = patch.sourceBranch;
      }
      if (patch.createSourceBranchIfMissing !== undefined) {
        persistable.createSourceBranchIfMissing = patch.createSourceBranchIfMissing;
      }
      if (patch.repoId !== undefined) {
        persistable.repoId = patch.repoId;
      }
      if (patch.fluxWorkBranch !== undefined) {
        persistable.fluxWorkBranch = patch.fluxWorkBranch;
      }
      if (patchGh !== undefined) {
        persistable.githubPr = patchGh;
      }
      if (Object.keys(persistable).length === 0) return;

      const existing = pendingRef.current.get(id);
      if (existing) clearTimeout(existing.timer);
      const preFlushTask =
        existing?.preFlushTask ?? tasksRef.current.find((t) => t.id === id);
      if (!preFlushTask) return;
      Object.assign(
        persistable,
        assigneePatchForCloudAutoStartOnUnblock({
          projectKind: project?.kind,
          actorUid: uid ?? undefined,
          previousAssigneeId: preFlushTask.assigneeId,
          patch,
        }),
      );
      const merged: TaskPatch = { ...existing?.patch, ...persistable };
      const timer = setTimeout(() => {
        void flushUpdate(id);
      }, UPDATE_DEBOUNCE_MS);
      pendingRef.current.set(id, { patch: merged, timer, preFlushTask });
    },
    [flushUpdate, project?.kind, uid],
  );

  const handleAutoStartWhenUnblockedProjectChange = useCallback(
    (enabled: boolean) => {
      setAutoStartWhenUnblockedProject(enabled);
      if (!enabled || project?.kind !== 'cloud' || !provider) {
        return;
      }
      const ids = taskIdsToClearAutoStartOnUnblockWhenAutomationEnables(tasksRef.current);
      for (const id of ids) {
        void handleUpdateTask(id, { autoStartOnUnblock: null });
      }
    },
    [project?.kind, provider, handleUpdateTask],
  );

  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      if (!provider) return;
      const { source, destination, draggableId } = result;
      if (!destination) return;
      if (
        source.droppableId === destination.droppableId &&
        source.index === destination.index
      ) {
        return;
      }
      const nextStatus = destination.droppableId as TaskStatus;

      // Compute new orderKey for the destination position using the CURRENT
      // task list excluding the dragged item. This keeps the destination
      // column stable whether the move is intra- or inter-column.
      const destCol = sortColumn(
        tasks.filter((t) => t.id !== draggableId),
        nextStatus,
      );
      let nextOrderKey: string;
      try {
        nextOrderKey = keyForInsert(destCol, destination.index);
      } catch (err) {
        console.error('[dragEnd] keyForInsert failed; using fallback', err);
        nextOrderKey = String(Date.now());
      }

      const previous = tasks.find((t) => t.id === draggableId);
      if (!previous) return;

      setTasks((prev) =>
        prev.map((t) =>
          t.id === draggableId
            ? { ...t, status: nextStatus, orderKey: nextOrderKey }
            : t,
        ),
      );

      const needsDoneLock =
        project?.kind === 'cloud' && previous.status !== 'done' && nextStatus === 'done';
      try {
        const dragPatch: TaskPatch = {
          status: nextStatus,
          orderKey: nextOrderKey,
        };
        if (
          project?.kind === 'cloud' &&
          nextStatus === 'in-progress' &&
          uid &&
          !previous.assigneeId
        ) {
          dragPatch.assigneeId = uid;
        }
        const execDrag = async () => {
          let localCleanupSpinnerId: string | null = null;
          if (
            project?.kind === 'local' &&
            previous.status !== 'done' &&
            nextStatus === 'done'
          ) {
            try {
              if (await window.electronAPI.project.getAutoCleanupWorkspaceWhenDone()) {
                localCleanupSpinnerId = draggableId;
                setCleanupLoadingTaskId(draggableId);
              }
            } catch {
              /* ignore */
            }
          }
          try {
            const updated = await provider.update(draggableId, dragPatch);
            const pending = pendingRef.current.get(draggableId);
            const localBeforeServer =
              tasksRef.current.find((t) => t.id === draggableId) ?? previous;
            const merged = mergeServerTaskWithPendingPatchOntoLocal(
              localBeforeServer,
              updated,
              pending?.patch,
            );
            let rowLocked = false;
            if (project?.kind === 'cloud') {
              const allTasksForSession = tasksRef.current.map((t) =>
                t.id === draggableId ? merged : t,
              );
              await maybeCloudAutoStartSessionOnInProgressTransition(
                previous,
                merged,
                allTasksForSession,
                {
                  source: 'cloud:dragEnd',
                  inFlight: cloudUnblockInFlightRef.current,
                  logError: (msg, data) => console.error(msg, data),
                  actorUid: uid,
                },
              );
              if (previous.status !== 'done' && merged.status === 'done') {
                const follow = await runCloudDoneTransitionFollowUp({
                  previous,
                  updated: merged,
                  allAfter: allTasksForSession,
                  provider,
                  actorUid: uid ?? null,
                  unblockInFlight: cloudUnblockInFlightRef.current,
                  getTasks: () => tasksRef.current,
                  setCleanupLoadingTaskId: (tid) => setCleanupLoadingTaskId(tid),
                  onStripSessions: stripLocalSessionStateForTask,
                });
                maybeStripSessionsAfterNewWorkspaceClean(
                  previous,
                  follow.workspaceCleaned ? follow.task : merged,
                );
                if (follow.workspaceCleaned) {
                  setTasks((prev) =>
                    prev.map((t) =>
                      t.id === follow.task.id ? mergeTaskRowPreserveMissing(t, follow.task) : t,
                    ),
                  );
                  rowLocked = true;
                }
              }
            } else {
              maybeStripSessionsAfterNewWorkspaceClean(previous, merged);
            }
            if (!rowLocked) {
              setTasks((prev) =>
                prev.map((t) => {
                  if (t.id !== draggableId) return t;
                  return mergeServerTaskWithPendingPatchOntoLocal(t, updated, pending?.patch);
                }),
              );
            }
          } finally {
            if (localCleanupSpinnerId) setCleanupLoadingTaskId(null);
          }
        };
        if (needsDoneLock) {
          cloudInlineDoneFollowUpTaskIdsRef.current.add(draggableId);
          try {
            await execDrag();
          } finally {
            cloudInlineDoneFollowUpTaskIdsRef.current.delete(draggableId);
          }
        } else {
          await execDrag();
        }
      } catch (err) {
        console.error('[tasks.update] drag-end failed', err);
      }
    },
    [provider, project?.kind, tasks, uid, stripLocalSessionStateForTask, maybeStripSessionsAfterNewWorkspaceClean],
  );

  const handleMarkTaskDone = useCallback(
    async (taskId: string, ui?: { closeDetail?: boolean; goToBoard?: boolean }) => {
      if (!provider) return;
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status === 'done') return;
      if (isTaskBlocked(task, tasks)) return;

      const pending = pendingRef.current.get(taskId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRef.current.delete(taskId);
      }

      const destCol = sortColumn(
        tasks.filter((t) => t.id !== taskId),
        'done',
      );
      let nextOrderKey: string;
      try {
        nextOrderKey = keyForInsert(destCol, destCol.length);
      } catch (err) {
        console.error('[markTaskDone] keyForInsert failed; using fallback', err);
        nextOrderKey = String(Date.now());
      }

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: 'done' as const, orderKey: nextOrderKey }
            : t,
        ),
      );
      if (ui?.closeDetail) setSelectedTaskId(null);
      if (ui?.goToBoard) {
        leaveSettingsIfActive();
        setActiveTabId('board');
      }

      const needsDoneLock = project?.kind === 'cloud';
      const execMarkDone = async () => {
        let localCleanupSpinnerId: string | null = null;
        if (project?.kind === 'local') {
          try {
            if (await window.electronAPI.project.getAutoCleanupWorkspaceWhenDone()) {
              localCleanupSpinnerId = taskId;
              setCleanupLoadingTaskId(taskId);
            }
          } catch {
            /* ignore */
          }
        }
        try {
          const updated = await provider.update(taskId, {
            status: 'done',
            orderKey: nextOrderKey,
          });
          let rowLocked = false;
          if (project?.kind === 'cloud' && task.status !== 'done' && updated.status === 'done') {
            const allAfter = tasksRef.current.map((t) =>
              t.id === taskId ? mergeTaskRowPreserveMissing(t, updated) : t,
            );
            const follow = await runCloudDoneTransitionFollowUp({
              previous: task,
              updated,
              allAfter,
              provider,
              actorUid: uidRef.current,
              unblockInFlight: cloudUnblockInFlightRef.current,
              getTasks: () => tasksRef.current,
              setCleanupLoadingTaskId: (tid) => setCleanupLoadingTaskId(tid),
              onStripSessions: stripLocalSessionStateForTask,
            });
            maybeStripSessionsAfterNewWorkspaceClean(
              task,
              follow.workspaceCleaned ? follow.task : updated,
            );
            if (follow.workspaceCleaned) {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === follow.task.id ? mergeTaskRowPreserveMissing(t, follow.task) : t,
                ),
              );
              rowLocked = true;
            }
          } else {
            maybeStripSessionsAfterNewWorkspaceClean(task, updated);
          }
          if (!rowLocked) {
            setTasks((prev) =>
              prev.map((t) => (t.id === taskId ? mergeTaskRowPreserveMissing(t, updated) : t)),
            );
          }
        } finally {
          if (localCleanupSpinnerId) setCleanupLoadingTaskId(null);
        }
      };
      try {
        if (needsDoneLock) {
          cloudInlineDoneFollowUpTaskIdsRef.current.add(taskId);
          try {
            await execMarkDone();
          } finally {
            cloudInlineDoneFollowUpTaskIdsRef.current.delete(taskId);
          }
        } else {
          await execMarkDone();
        }
      } catch (err) {
        console.error('[tasks.update] mark done failed', err);
      }
    },
    [provider, tasks, project?.kind, stripLocalSessionStateForTask, maybeStripSessionsAfterNewWorkspaceClean],
  );

  const handleCreateTask = useCallback(
    async (
      title: string,
      agent: Agent | null,
      labelInput?: string[],
      assigneeId?: string,
      branch?: {
        sourceBranch?: string;
        createSourceBranchIfMissing?: boolean;
        repoId?: string;
      },
    ) => {
      if (!provider) return;
      try {
        // Append to the bottom of the backlog column.
        const backlog = sortColumn(tasks, 'backlog');
        let orderKey: string | undefined;
        try {
          orderKey = keyForInsert(backlog, backlog.length);
        } catch {
          orderKey = undefined;
        }
        const labels = normalizeTaskLabels(labelInput);
        const spawnFields =
          project && agent != null
            ? mergedTaskCreateAgentFields(project, agent, undefined, undefined)
            : {};
        const task = await provider.create({
          title,
          agent,
          orderKey,
          ...spawnFields,
          ...(labels.length > 0 ? { labels } : {}),
          ...(assigneeId ? { assigneeId } : {}),
          ...(branch?.sourceBranch !== undefined ? { sourceBranch: branch.sourceBranch } : {}),
          ...(branch?.createSourceBranchIfMissing !== undefined
            ? { createSourceBranchIfMissing: branch.createSourceBranchIfMissing }
            : {}),
          ...(branch?.repoId !== undefined ? { repoId: branch.repoId } : {}),
        });
        setTasks((prev) => {
          if (prev.some((t) => t.id === task.id)) return prev;
          return [...prev, task];
        });
      } catch (err) {
        console.error('[tasks.create] failed', err);
      }
    },
    [provider, project, tasks],
  );

  const handleDeleteTask = useCallback(
    async (id: string) => {
      if (!provider) return;
      const pending = pendingRef.current.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRef.current.delete(id);
      }
      try {
        const { errors } = await window.electronAPI.tasks.cleanupResources(id);
        if (errors.length > 0) {
          console.error('[tasks.cleanupResources] during task delete', errors);
          setCleanupError(
            `Workspace cleanup had issues (the task was still removed):\n${errors.join('\n')}`,
          );
        }
        stripLocalSessionStateForTask(id);
        await provider.delete(id);
        setTasks((prev) => prev.filter((t) => t.id !== id));
        setSelectedTaskId((sid) => (sid === id ? null : sid));
      } catch (err) {
        console.error('[tasks.delete] failed', err);
        setCleanupError(
          err instanceof Error ? err.message : 'Could not delete task or clean up workspace.',
        );
      }
    },
    [provider, stripLocalSessionStateForTask],
  );

  const requestDeleteTask = useCallback(
    (id: string, opts?: { closeDetail?: boolean }) => {
      if (taskDeleteNeedsWorkspaceConfirmation(id, sessions, taskHasWorktreeById)) {
        setTaskDeleteConfirmId(id);
        return;
      }
      if (opts?.closeDetail) setSelectedTaskId(null);
      void handleDeleteTask(id);
    },
    [sessions, taskHasWorktreeById, handleDeleteTask],
  );

  const cancelTaskDeleteConfirm = useCallback(() => {
    setTaskDeleteConfirmId(null);
  }, []);

  const confirmTaskDelete = useCallback(() => {
    const id = taskDeleteConfirmId;
    if (!id) return;
    setTaskDeleteConfirmId(null);
    void handleDeleteTask(id);
  }, [taskDeleteConfirmId, handleDeleteTask]);

  const requestCleanupTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status !== 'done' || task.workspaceCleanedAt) return;
      setCleanupError(null);
      setCleanupConfirmTaskId(taskId);
    },
    [tasks],
  );

  const handleTaskPrClick = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;
      const existingUrl = task.githubPr?.url?.trim();
      if (existingUrl) {
        setTaskPrError(null);
        void window.electronAPI.openExternalUrl(existingUrl);
        return;
      }
      if (!providerRef.current) {
        setTaskPrError('Task list is not ready yet. Try again in a moment.');
        return;
      }
      if (createPrInflightTaskIdRef.current === taskId) return;

      createPrInflightTaskIdRef.current = taskId;
      setPrLoadingTaskId(taskId);
      setTaskPrError(null);
      try {
        const title = task.title.trim();
        const result = await window.electronAPI.tasks.requestPullRequestFromAgent({
          taskId,
          ...(title ? { title } : {}),
          ...(task.sourceBranch?.trim() ? { sourceBranch: task.sourceBranch } : {}),
          ...(task.createSourceBranchIfMissing !== undefined
            ? { createSourceBranchIfMissing: task.createSourceBranchIfMissing }
            : {}),
          ...(task.repoId?.trim() ? { repoId: task.repoId } : {}),
        });
        if (!result.ok) {
          setTaskPrError(formatTaskPullRequestError(result));
          return;
        }
        prAgentPromptSentTaskIdsRef.current.add(taskId);
        setPrAgentAwaitingByTaskId((prev) => ({ ...prev, [taskId]: true }));
        schedulePrAgentFollowupDiscovery(taskId);
      } catch (err) {
        console.error('[tasks.requestPullRequestFromAgent] failed', err);
        setTaskPrError(
          err instanceof Error ? err.message : 'Could not create the pull request.',
        );
      } finally {
        createPrInflightTaskIdRef.current = null;
        setPrLoadingTaskId(null);
      }
    },
    [schedulePrAgentFollowupDiscovery],
  );

  const cancelCleanupTask = useCallback(() => {
    setCleanupConfirmTaskId(null);
  }, []);

  const confirmCleanupTask = useCallback(async () => {
    const taskId = cleanupConfirmTaskId;
    if (!taskId) return;
    setCleanupConfirmTaskId(null);
    setCleanupLoadingTaskId(taskId);
    setCleanupError(null);
    try {
      const { errors } = await window.electronAPI.tasks.cleanupResources(taskId);
      stripLocalSessionStateForTask(taskId);
      if (errors.length > 0) {
        setCleanupError(errors.join('\n'));
      } else if (provider) {
        try {
          const updated = await provider.update(taskId, {
            workspaceCleanedAt: new Date().toISOString(),
          });
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? mergeTaskRowPreserveMissing(t, updated) : t)),
          );
        } catch (err) {
          console.error('[tasks.update] workspaceCleanedAt failed', err);
        }
      }
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : String(err));
    } finally {
      setCleanupLoadingTaskId(null);
    }
  }, [cleanupConfirmTaskId, provider, stripLocalSessionStateForTask]);

  const handleProjectActivated = useCallback((p: ActiveProject) => {
    setProject(p);
    setSelectedTaskId(null);
    setTaskDeleteConfirmId(null);
    setCleanupConfirmTaskId(null);
    setCleanupLoadingTaskId(null);
    setCleanupError(null);
    setPrLoadingTaskId(null);
    setTaskPrError(null);
    for (const timers of prAgentFollowupTimersByTaskIdRef.current.values()) {
      for (const t of timers) window.clearTimeout(t);
    }
    prAgentFollowupTimersByTaskIdRef.current.clear();
    prAgentPromptSentTaskIdsRef.current.clear();
    setPrAgentAwaitingByTaskId({});
    setPlanPanelOpen(false);
    setPlanningSidebarOpen(false);
    replaceProjectWorkspaceRoute();
    setActiveTabId('board');
    setDocsSidebarExpanded(false);
    setPlanningDocFiles([]);
    setPlanningDocsListError(null);
    setSelectedPlanningDocPath(null);
    setPlanningDocFileRevision(0);
    setPlanningSessions([]);
    setPlanningSidebarActiveId(null);
    setOpenPlanningMainTabIds(new Set());
  }, []);

  const handleClearProject = useCallback(async () => {
    await window.electronAPI.projects.clearActive();
    setProject(null);
    setTasks([]);
    setSelectedTaskId(null);
    setTaskDeleteConfirmId(null);
    setCleanupConfirmTaskId(null);
    setCleanupLoadingTaskId(null);
    setCleanupError(null);
    setPrLoadingTaskId(null);
    setTaskPrError(null);
    for (const timers of prAgentFollowupTimersByTaskIdRef.current.values()) {
      for (const t of timers) window.clearTimeout(t);
    }
    prAgentFollowupTimersByTaskIdRef.current.clear();
    prAgentPromptSentTaskIdsRef.current.clear();
    setPrAgentAwaitingByTaskId({});
    setPlanPanelOpen(false);
    setPlanningSidebarOpen(false);
    replaceProjectWorkspaceRoute();
    setDocsSidebarExpanded(false);
    setPlanningDocFiles([]);
    setPlanningDocsListError(null);
    setSelectedPlanningDocPath(null);
    setPlanningDocFileRevision(0);
    setPlanningSessions([]);
    setPlanningSidebarActiveId(null);
    setOpenPlanningMainTabIds(new Set());
    setSessions([]);
    setOpenTabIds(new Set());
    setActiveTabId('board');
  }, []);

  const confirmLeaveDocsWithUnsavedEdits = useCallback((): boolean => {
    if (activeTabId !== 'docs' || !planningDocsDirtyRef.current) return true;
    return window.confirm(
      'You have unsaved changes in the open planning document. Leave Docs without saving?',
    );
  }, [activeTabId]);

  const handlePlanningDocsDirtyChange = useCallback((dirty: boolean) => {
    planningDocsDirtyRef.current = dirty;
  }, []);

  const handlePlanNav = useCallback(() => {
    if (!confirmLeaveDocsWithUnsavedEdits()) return;
    leaveSettingsIfActive();
    const routeSid = parsePlanTabId(activeTabId);
    if (routeSid) {
      setPlanningSidebarActiveId(routeSid);
      setPlanningSidebarOpen(true);
      setActiveTabId('board');
      return;
    }
    if (activeTabId === 'plan') {
      setActiveTabId('board');
      return;
    }
    if (activeTabId !== 'board') {
      setActiveTabId('board');
      setPlanningSidebarOpen(true);
      return;
    }
    if (!planningSidebarOpen) {
      setPlanningSidebarOpen(true);
    } else {
      setActiveTabId('plan');
      setPlanningSidebarOpen(false);
    }
  }, [activeTabId, planningSidebarOpen, confirmLeaveDocsWithUnsavedEdits]);

  const handleDocsNav = useCallback(() => {
    leaveSettingsIfActive();
    setActiveTabId('docs');
    setDocsSidebarExpanded(true);
  }, []);

  const handleDocsSidebarExpandToggle = useCallback(() => {
    setDocsSidebarExpanded((v) => !v);
  }, []);

  const handleSelectPlanningDoc = useCallback(
    (relativePath: string) => {
      leaveSettingsIfActive();
      if (
        planningDocsDirtyRef.current &&
        selectedPlanningDocPath != null &&
        relativePath !== selectedPlanningDocPath &&
        !window.confirm(
          'Switch documents without saving? Unsaved changes to the current file will be lost.',
        )
      ) {
        return;
      }
      setSelectedPlanningDocPath(relativePath);
      setActiveTabId('docs');
    },
    [selectedPlanningDocPath],
  );

  const maxPlanningWidthForRow = useCallback(() => {
    const row = boardRowRef.current;
    const w = row?.getBoundingClientRect().width ?? window.innerWidth;
    return Math.max(MIN_PLANNING_PANEL_WIDTH, w - MIN_BOARD_REMAINING_PX);
  }, []);

  useEffect(() => {
    const stored = readStoredPlanningWidth();
    if (stored != null) {
      setPlanPanelWidth(clampPlanningWidth(stored, maxPlanningWidthForRow()));
    }
  }, [maxPlanningWidthForRow]);

  useEffect(() => {
    const onResize = () => {
      setPlanPanelWidth((prev) =>
        clampPlanningWidth(prev, maxPlanningWidthForRow()),
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [maxPlanningWidthForRow]);

  useLayoutEffect(() => {
    if (!planPanelOpen) return;
    setPlanPanelWidth((prev) =>
      clampPlanningWidth(prev, maxPlanningWidthForRow()),
    );
  }, [planPanelOpen, maxPlanningWidthForRow]);

  const persistPlanningWidth = useCallback((w: number) => {
    try {
      localStorage.setItem(PLANNING_PANEL_WIDTH_KEY, String(w));
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const handlePlanningResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!planPanelOpen) return;
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget;
      const startX = e.clientX;
      const startW = planPanelWidth;
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: globalThis.PointerEvent) => {
        const next = startW + (startX - ev.clientX);
        setPlanPanelWidth(
          clampPlanningWidth(next, maxPlanningWidthForRow()),
        );
      };

      const onUp = (ev: globalThis.PointerEvent) => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        setPlanPanelWidth((prev) => {
          const capped = clampPlanningWidth(prev, maxPlanningWidthForRow());
          persistPlanningWidth(capped);
          return capped;
        });
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [planPanelOpen, planPanelWidth, maxPlanningWidthForRow, persistPlanningWidth],
  );

  const handlePlanningResizeDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!planPanelOpen) return;
      e.preventDefault();
      e.stopPropagation();
      const maxW = maxPlanningWidthForRow();
      const next = clampPlanningWidth(DEFAULT_PLANNING_PANEL_WIDTH, maxW);
      setPlanPanelWidth(next);
      persistPlanningWidth(next);
    },
    [planPanelOpen, maxPlanningWidthForRow, persistPlanningWidth],
  );

  const handleOpenSessionTab = useCallback((session: Session) => {
    if (!confirmLeaveDocsWithUnsavedEdits()) return;
    leaveSettingsIfActive();
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === session.id);
      if (exists) {
        return prev.map((s) => (s.id === session.id ? session : s));
      }
      return [...prev, session];
    });
    setOpenTabIds((prev) => {
      if (prev.has(session.id)) return prev;
      const next = new Set(prev);
      next.add(session.id);
      return next;
    });
    setMinimizedWorkspaceIds((prev) => {
      if (!prev.has(session.id)) return prev;
      const next = new Set(prev);
      next.delete(session.id);
      return next;
    });
    setActiveTabId(session.id);
    setSelectedTaskId(null);
  }, [confirmLeaveDocsWithUnsavedEdits]);

  const handleOpenTaskWorkspaceFromBoard = useCallback(
    (taskId: string) => {
      const session = selectSessionForTaskWorkspace(sessions, taskId);
      if (!session) return;
      handleOpenSessionTab(session);
    },
    [sessions, handleOpenSessionTab],
  );

  const handleOpenSessionFromSidebar = useCallback(
    (sessionId: string) => {
      if (!confirmLeaveDocsWithUnsavedEdits()) return;
      leaveSettingsIfActive();
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;
      setOpenTabIds((prev) => {
        if (prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });
      setMinimizedWorkspaceIds((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      setActiveTabId(sessionId);
      setSelectedTaskId(null);
    },
    [sessions, confirmLeaveDocsWithUnsavedEdits],
  );

  const handleCloseSessionTab = useCallback((sessionId: string) => {
    setOpenTabIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    setActiveTabId((prev) => (prev === sessionId ? 'board' : prev));
  }, []);

  const handleOpenPlanningInMainTab = useCallback(
    (sessionId: string) => {
      if (!confirmLeaveDocsWithUnsavedEdits()) return;
      leaveSettingsIfActive();
      setOpenPlanningMainTabIds((prev) => new Set(prev).add(sessionId));
      setActiveTabId(planTabId(sessionId));
    },
    [confirmLeaveDocsWithUnsavedEdits],
  );

  const handleClosePlanningMainTab = useCallback(
    async (sessionId: string) => {
      try {
        await window.electronAPI.planning.stop(sessionId);
      } catch (err) {
        console.error('[App] planning.stop (main tab) failed', err);
      }
      await refreshPlanningSessions();
      setOpenPlanningMainTabIds((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      setActiveTabId((prev) => (prev === planTabId(sessionId) ? 'board' : prev));
      setPlanningSidebarActiveId((cur) => (cur === sessionId ? null : cur));
    },
    [refreshPlanningSessions],
  );

  const handlePlanningActiveSessionChange = useCallback(
    (id: string | null) => {
      if (activeTabId === 'board' || activeTabId === 'plan') {
        setPlanningSidebarActiveId(id);
        return;
      }
      const cur = parsePlanTabId(activeTabId);
      if (cur && id && id !== cur) {
        setOpenPlanningMainTabIds((prev) => {
          const next = new Set(prev);
          next.delete(cur);
          next.add(id);
          return next;
        });
        setActiveTabId(planTabId(id));
      }
      setPlanningSidebarActiveId(id);
    },
    [activeTabId],
  );

  const handlePlanningPanelClose = useCallback(() => {
    const sid = parsePlanTabId(activeTabId);
    if (sid) {
      void handleClosePlanningMainTab(sid);
      return;
    }
    if (activeTabId === 'plan') {
      setActiveTabId('board');
      setPlanningSidebarOpen(false);
      return;
    }
    setPlanningSidebarOpen(false);
  }, [activeTabId, handleClosePlanningMainTab]);

  const handleOpenSettingsTab = useCallback(() => {
    if (activeTabId === 'docs' && !confirmLeaveDocsWithUnsavedEdits()) {
      return;
    }
    if (readProjectHashRoute() !== 'settings') {
      pushProjectSettingsRoute();
    }
  }, [activeTabId, confirmLeaveDocsWithUnsavedEdits]);

  const handleCloseSettingsTab = useCallback(() => {
    replaceProjectWorkspaceRoute();
  }, []);

  const handleSelectWorkspaceTab = useCallback(
    (tabId: string) => {
      if (tabId === 'settings') {
        if (activeTabId === 'docs' && !confirmLeaveDocsWithUnsavedEdits()) {
          return;
        }
        if (readProjectHashRoute() !== 'settings') {
          pushProjectSettingsRoute();
        }
        return;
      }
      if (
        activeTabId === 'docs' &&
        tabId !== 'docs' &&
        !confirmLeaveDocsWithUnsavedEdits()
      ) {
        return;
      }
      leaveSettingsIfActive();
      setActiveTabId(tabId);
    },
    [activeTabId, confirmLeaveDocsWithUnsavedEdits],
  );

  const handleSelectPlanningTabFromBar = useCallback(
    (sessionId: string) => {
      if (!confirmLeaveDocsWithUnsavedEdits()) return;
      leaveSettingsIfActive();
      setActiveTabId(planTabId(sessionId));
    },
    [confirmLeaveDocsWithUnsavedEdits],
  );

  useEffect(() => {
    try {
      localStorage.setItem('flux.sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  const handleCollapseSidebar = useCallback(() => setSidebarCollapsed(true), []);
  const handleExpandSidebar = useCallback(() => setSidebarCollapsed(false), []);

  const handleMinimizeSession = useCallback((sessionId: string) => {
    setMinimizedWorkspaceIds((prev) => {
      if (prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
  }, []);

  const handleDeleteWorkspace = useCallback(async (sessionId: string) => {
    try {
      await window.electronAPI.sessions.deleteWorkspace(sessionId);
    } catch (err) {
      console.error('[session.deleteWorkspace] failed', err);
    }
    invalidateSessionAttachCache(sessionId);
    setMinimizedWorkspaceIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setOpenTabIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    setActiveTabId((prev) => (prev === sessionId ? 'board' : prev));
  }, []);

  const requestDeleteWorkspace = useCallback((sessionId: string) => {
    setDeleteConfirmId(sessionId);
  }, []);

  const cancelDeleteWorkspace = useCallback(() => {
    setDeleteConfirmId(null);
  }, []);

  const confirmDeleteWorkspace = useCallback(async () => {
    const id = deleteConfirmId;
    if (!id) return;
    setDeleteConfirmId(null);
    await handleDeleteWorkspace(id);
  }, [deleteConfirmId, handleDeleteWorkspace]);

  const inProgressCount = tasks.filter((t) => t.status === 'in-progress').length;
  const needsInputCount = tasks.filter((t) => t.status === 'needs-input').length;
  const reviewCount = tasks.filter((t) => t.status === 'review').length;
  const statusLine = `${inProgressCount} in progress · ${needsInputCount} needs input · ${reviewCount} in review`;

  const sessionItems = useMemo(
    () => buildSessionTabs(sessions, tasks),
    [sessions, tasks],
  );

  const sidebarSessionItems = useMemo(
    () => sessionItems.filter((item) => !minimizedWorkspaceIds.has(item.session.id)),
    [sessionItems, minimizedWorkspaceIds],
  );

  const openTabItems = useMemo(
    () => sessionItems.filter((item) => openTabIds.has(item.session.id)),
    [sessionItems, openTabIds],
  );

  const activeSessionTab = useMemo(() => {
    if (!isWorkspaceSessionTabId(activeTabId)) return null;
    return sessionItems.find((t) => t.session.id === activeTabId) ?? null;
  }, [activeTabId, sessionItems]);

  const openPlanningTabItems = useMemo(() => {
    return [...openPlanningMainTabIds].map((sessionId) => {
      const s = planningSessions.find((x) => x.id === sessionId);
      const idx = planningSessions.findIndex((x) => x.id === sessionId);
      const agentLabel = s
        ? (AGENTS.find((a) => a.id === s.agent)?.label ?? s.agent)
        : '';
      const title =
        s && idx >= 0 ? `Plan ${idx + 1} · ${agentLabel}` : 'Planning';
      return {
        sessionId,
        title,
        running: s?.status === 'running',
      };
    });
  }, [openPlanningMainTabIds, planningSessions]);

  const planningPanelActiveSessionId = useMemo(() => {
    const sid = parsePlanTabId(activeTabId);
    if (sid) return sid;
    return planningSidebarActiveId;
  }, [activeTabId, planningSidebarActiveId]);

  const deleteConfirmSession = useMemo(
    () => (deleteConfirmId ? sessionItems.find((s) => s.session.id === deleteConfirmId) ?? null : null),
    [deleteConfirmId, sessionItems],
  );

  const cleanupConfirmTask = useMemo(
    () =>
      cleanupConfirmTaskId
        ? tasks.find((t) => t.id === cleanupConfirmTaskId) ?? null
        : null,
    [cleanupConfirmTaskId, tasks],
  );

  const taskDeleteConfirmTask = useMemo(
    () =>
      taskDeleteConfirmId ? tasks.find((t) => t.id === taskDeleteConfirmId) ?? null : null,
    [taskDeleteConfirmId, tasks],
  );

  // Sort tasks per column for the board (orderKey-aware). Falls back to
  // createdAt/id for rows without a key.
  const sortedTasks = useMemo(() => {
    return COLUMNS.flatMap((col) => sortColumn(tasks, col.id));
  }, [tasks]);

  const remoteRunnerForSelected = useMemo(
    () =>
      selectedTask && cloudProjectId
        ? findRemoteRunner(runners.byTask.get(selectedTask.id), uid, projectMembers)
        : null,
    [selectedTask, cloudProjectId, runners.byTask, uid, projectMembers],
  );

  if (activationLoading || auth.status === 'loading') {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#09090b] text-white">
        {isMac ? (
          <div
            className="app-window-drag h-10 w-full shrink-0 bg-[#09090b]"
            aria-hidden
          />
        ) : null}
        <div className="app-window-no-drag flex min-h-0 flex-1 flex-col overflow-hidden">
          <LoadingScreen />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#09090b] text-white">
        {isMac ? (
          <div
            className="app-window-drag h-10 w-full shrink-0 bg-[#09090b]"
            aria-hidden
          />
        ) : null}
        <div className="app-window-no-drag flex min-h-0 flex-1 flex-col overflow-hidden">
          <ProjectsListView
            onProjectActivated={handleProjectActivated}
            auth={auth}
            cloudProjects={cloudProjectsState}
            invites={invitesState}
            authSlot={<SignInCard />}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#09090b] text-zinc-100">
      {isMac ? (
        <div
          className="app-window-drag h-10 w-full shrink-0 bg-[#09090b]"
          aria-hidden
        />
      ) : null}
      <div className="app-window-no-drag flex min-h-0 flex-1 flex-col overflow-hidden">
        {cleanupError ? (
          <div
            role="alert"
            className="flex shrink-0 items-start gap-2 border-b border-amber-500/20 bg-amber-500/[0.08] px-4 py-2 text-[13px] text-amber-100/95"
          >
            <p className="min-w-0 flex-1 whitespace-pre-wrap leading-snug">{cleanupError}</p>
            <button
              type="button"
              onClick={() => setCleanupError(null)}
              className="shrink-0 rounded px-2 py-0.5 text-[12px] font-medium text-amber-200/90 hover:bg-amber-500/15"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        {taskPrError ? (
          <div
            role="alert"
            className="flex shrink-0 items-start gap-2 border-b border-rose-500/20 bg-rose-500/[0.08] px-4 py-2 text-[13px] text-rose-100/95"
          >
            <p className="min-w-0 flex-1 whitespace-pre-wrap leading-snug">{taskPrError}</p>
            <button
              type="button"
              onClick={() => setTaskPrError(null)}
              className="shrink-0 rounded px-2 py-0.5 text-[12px] font-medium text-rose-200/90 hover:bg-rose-500/15"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        <AppShell
          project={project}
          onClearProject={() => void handleClearProject()}
          activeTabId={activeTabId}
          settingsRouteActive={settingsRouteActive}
          onSelectTab={handleSelectWorkspaceTab}
          onOpenSettings={handleOpenSettingsTab}
          collapsed={sidebarCollapsed}
          onCollapse={handleCollapseSidebar}
          onExpand={handleExpandSidebar}
          onPlanNavClick={handlePlanNav}
          onDocsNavClick={handleDocsNav}
          docsSidebarExpanded={docsSidebarExpanded}
          onDocsSidebarExpandToggle={handleDocsSidebarExpandToggle}
          planningDocFiles={planningDocFiles}
          planningDocsCloudListMeta={planningDocsCloudListMeta}
          planningDocsFirestoreStream={planningDocsFirestoreStream}
          planningDocsFirebaseConfigured={isFirebaseConfigured()}
          planningDocsListLoading={planningDocsListLoading}
          planningDocsListError={planningDocsListError}
          selectedPlanningDocPath={selectedPlanningDocPath}
          onSelectPlanningDoc={handleSelectPlanningDoc}
          sessions={sidebarSessionItems}
          onOpenSession={handleOpenSessionFromSidebar}
          onMinimizeSession={handleMinimizeSession}
          onDeleteWorkspace={requestDeleteWorkspace}
        >
          <TopBar
            project={project}
            statusLine={statusLine}
            leadingInset={sidebarCollapsed}
          >
            <TabBar
              activeTabId={activeTabId}
              openSessions={openTabItems}
              openPlanningTabs={openPlanningTabItems}
              settingsRouteActive={settingsRouteActive}
              onSelectTab={handleSelectWorkspaceTab}
              onCloseSessionTab={handleCloseSessionTab}
              onSelectPlanningTab={handleSelectPlanningTabFromBar}
              onClosePlanningTab={(sessionId) => void handleClosePlanningMainTab(sessionId)}
              onCloseSettingsTab={handleCloseSettingsTab}
            />
          </TopBar>
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {/*
              Keep every open session's terminal mounted across tab switches so
              the xterm buffer (scrollback, TUI state) survives when the user
              flips to the board or another workspace. We stack all tabs at
              inset-0 and flip `visibility` rather than `display`: display:none
              would reflow the xterm container on every tab switch, which
              wipes the canvas/DOM and makes Claude's render history vanish.
              visibility:hidden keeps the layout stable, so buffers persist.
            */}
            {openTabItems.map((item) => {
              const isActive = activeTabId === item.session.id;
              const tabTask = tasks.find((t) => t.id === item.session.taskId) ?? null;
              const tabTaskBlocked = tabTask ? isTaskBlocked(tabTask, tasks) : false;
              return (
                <div
                  key={item.session.id}
                  aria-hidden={!isActive || settingsRouteActive}
                  className="absolute inset-0 flex min-h-0 flex-col bg-[#09090b]"
                  style={{
                    visibility: isActive && !settingsRouteActive ? 'visible' : 'hidden',
                    pointerEvents: isActive && !settingsRouteActive ? 'auto' : 'none',
                    zIndex: isActive ? 2 : 1,
                  }}
                >
                  <SessionTerminalView
                    session={item.session}
                    visible={isActive && !settingsRouteActive}
                    task={tabTask}
                    agentSessionLifecycle={
                      tabTask
                        ? {
                            projectTasks: tasks,
                            requesterUid: project.kind === 'cloud' ? uid : undefined,
                          }
                        : undefined
                    }
                    onAgentSessionStartSuccess={
                      tabTask
                        ? (taskId: string) => {
                            const t = tasks.find((x) => x.id === taskId);
                            if (!t) return;
                            const patch: TaskPatch = { status: 'in-progress' };
                            if (project.kind === 'cloud' && uid && !t.assigneeId) {
                              patch.assigneeId = uid;
                            }
                            void handleUpdateTask(taskId, patch);
                          }
                        : undefined
                    }
                    markAsDoneBlocked={tabTaskBlocked}
                    onMarkAsDone={
                      tabTask && tabTask.status !== 'done' && !tabTaskBlocked
                        ? () => void handleMarkTaskDone(item.session.taskId, { goToBoard: true })
                        : undefined
                    }
                    onTaskPrClick={(id) => void handleTaskPrClick(id)}
                    prLoading={prLoadingTaskId === item.session.taskId}
                    prAgentAwaiting={Boolean(prAgentAwaitingByTaskId[item.session.taskId])}
                    taskDetailPanel={
                      tabTask
                        ? {
                            projectTasks: tasks,
                            taskSessionStartPending: sessionStartPendingTaskIds.has(
                              tabTask.id,
                            ),
                            implicitSessionAssigneeUid:
                              project.kind === 'cloud' ? uid : undefined,
                            onSelectTask: (id) => {
                              leaveSettingsIfActive();
                              setSelectedTaskId(id);
                              setActiveTabId('board');
                            },
                            onClose: () => {
                              /* Session workspace Details tab is not a dismissible overlay. */
                            },
                            onUpdate: handleUpdateTask,
                            onDelete: requestDeleteTask,
                            remoteRunner:
                              tabTask && cloudProjectId
                                ? findRemoteRunner(
                                    runners.byTask.get(tabTask.id),
                                    uid,
                                    projectMembers,
                                  )
                                : null,
                            onOpenSessionTab: handleOpenSessionTab,
                            onMinimizeSession: handleMinimizeSession,
                            onMarkAsDone:
                              tabTask.status !== 'done' && !tabTaskBlocked
                                ? () =>
                                    void handleMarkTaskDone(item.session.taskId, {
                                      goToBoard: true,
                                    })
                                : undefined,
                            markAsDoneBlocked: tabTaskBlocked,
                            autoStartWhenUnblockedProject,
                            projectMembers,
                            cloudActiveRunnerSession:
                              project.kind === 'cloud'
                                ? runners.isRunningFresh(tabTask.id)
                                : false,
                            onTaskPrClick: (id) => void handleTaskPrClick(id),
                            prLoading: prLoadingTaskId === item.session.taskId,
                            prAgentAwaiting: Boolean(prAgentAwaitingByTaskId[item.session.taskId]),
                            projectRepos: projectRepos ?? undefined,
                            multiRepo2Enabled: true,
                          }
                        : undefined
                    }
                  />
                </div>
              );
            })}
            {/*
              Board, planning (sidebar + fullscreen), and docs share one persistent
              stack under session terminals. Toggle visibility instead of conditional
              mounts so the planning xterm instance (scrollback, TUI state) survives
              tab switches — matching SessionTerminalView. Project settings uses
              `#/settings` and renders in a separate full-view layer (not this stack).
              While a task session tab is focused, hide this stack but keep it mounted;
              session layers use z-index 1–2 so they stay above this workspace shell
              (z-index 0).
            */}
            <div
              className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
              aria-hidden={Boolean(activeSessionTab) || settingsRouteActive}
              style={{
                visibility: activeSessionTab || settingsRouteActive ? 'hidden' : 'visible',
                pointerEvents: activeSessionTab || settingsRouteActive ? 'none' : 'auto',
                zIndex: 0,
              }}
            >
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <div
                  className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
                  aria-hidden={!isBoardOrPlanTab}
                  style={{
                    visibility: isBoardOrPlanTab ? 'visible' : 'hidden',
                    pointerEvents: isBoardOrPlanTab ? 'auto' : 'none',
                    zIndex: isBoardOrPlanTab ? 1 : 0,
                  }}
                >
                  <div
                    ref={boardRowRef}
                    className="flex min-h-0 flex-1 overflow-hidden"
                  >
                    <div
                      className="relative flex min-h-0 min-w-0 flex-col overflow-hidden"
                      style={{
                        flex: isFullscreenPlanTab ? '0 0 0%' : '1 1 0%',
                        minWidth: isFullscreenPlanTab ? 0 : undefined,
                        visibility:
                          isBoardOrPlanTab && !isFullscreenPlanTab ? 'visible' : 'hidden',
                        pointerEvents:
                          isBoardOrPlanTab && !isFullscreenPlanTab ? 'auto' : 'none',
                      }}
                    >
                      <Board
                        allTasks={sortedTasks}
                        onDragEnd={handleDragEnd}
                        onCreateTask={handleCreateTask}
                        defaultTaskAgent={defaultTaskAgentForProject(project)}
                        onDeleteTask={requestDeleteTask}
                        onRequestCleanupTask={requestCleanupTask}
                        cleanupLoadingTaskId={cleanupLoadingTaskId}
                        onCardClick={(id) => setSelectedTaskId(id)}
                        autoStartWhenUnblockedProject={autoStartWhenUnblockedProject}
                        onPatchTaskAutoStartOnUnblock={(id, patch) =>
                          void handleUpdateTask(id, patch)
                        }
                        onTaskPrClick={(id) => void handleTaskPrClick(id)}
                        prLoadingTaskId={prLoadingTaskId}
                        prAgentAwaitingByTaskId={prAgentAwaitingByTaskId}
                        planPanelOpen={planPanelOpen}
                        onTogglePlanPanel={() => {
                          leaveSettingsIfActive();
                          setActiveTabId('board');
                          setPlanningSidebarOpen((v) => !v);
                        }}
                        projectMembers={projectMembers}
                        onTaskAssigneeChange={(id, assigneeId) =>
                          void handleUpdateTask(id, { assigneeId })
                        }
                        repoDefaultBranchShort={repoDefaultBranchShort}
                        projectRepos={projectRepos ?? undefined}
                        multiRepo2Enabled
                        cloudRepoBindingOverview={cloudRepoBindingOverview ?? undefined}
                        cloudUnblockAutostartClientUid={
                          project.kind === 'cloud' && uid ? uid : undefined
                        }
                        sessions={sessions}
                        taskHasWorktreeById={taskHasWorktreeById}
                        onTaskAgentSpawnPrefsChange={(id, patch) =>
                          void handleUpdateTask(id, patch)
                        }
                        onOpenTaskWorkspaceTab={handleOpenTaskWorkspaceFromBoard}
                      />
                      <TaskDetailPanel
                        task={selectedTask}
                        projectTasks={tasks}
                        taskSessionStartPending={Boolean(
                          selectedTask && sessionStartPendingTaskIds.has(selectedTask.id),
                        )}
                        implicitSessionAssigneeUid={
                          project.kind === 'cloud' ? uid : undefined
                        }
                        onSelectTask={(id) => setSelectedTaskId(id)}
                        onClose={() => setSelectedTaskId(null)}
                        onUpdate={handleUpdateTask}
                        onDelete={requestDeleteTask}
                        onMarkAsDone={
                          selectedTask && selectedTask.status !== 'done' && !isTaskBlocked(selectedTask, tasks)
                            ? () => void handleMarkTaskDone(selectedTask.id, { closeDetail: true })
                            : undefined
                        }
                        markAsDoneBlocked={Boolean(
                          selectedTask && isTaskBlocked(selectedTask, tasks),
                        )}
                        autoStartWhenUnblockedProject={autoStartWhenUnblockedProject}
                        remoteRunner={remoteRunnerForSelected}
                        cloudActiveRunnerSession={
                          project.kind === 'cloud' && selectedTask
                            ? runners.isRunningFresh(selectedTask.id)
                            : false
                        }
                        onOpenSessionTab={handleOpenSessionTab}
                        onMinimizeSession={handleMinimizeSession}
                        projectMembers={projectMembers}
                        onTaskPrClick={(id) => void handleTaskPrClick(id)}
                        prLoading={
                          selectedTask ? prLoadingTaskId === selectedTask.id : false
                        }
                        prAgentAwaiting={
                          selectedTask
                            ? Boolean(prAgentAwaitingByTaskId[selectedTask.id])
                            : false
                        }
                        projectRepos={projectRepos ?? undefined}
                        multiRepo2Enabled
                      />
                    </div>
                    <div
                      className={`relative flex shrink-0 flex-col overflow-hidden ${
                        isFullscreenPlanTab || (activeTabId === 'board' && planPanelOpen)
                          ? ''
                          : 'pointer-events-none'
                      }`}
                      style={{
                        width: isFullscreenPlanTab
                          ? undefined
                          : planPanelOpen
                            ? planPanelWidth
                            : 0,
                        flex: isFullscreenPlanTab ? '1 1 0%' : undefined,
                        minWidth: isFullscreenPlanTab ? 0 : undefined,
                      }}
                    >
                      {activeTabId === 'board' && planPanelOpen ? (
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label="Resize planning panel"
                          title="Drag to resize. Double-click to reset."
                          className="absolute bottom-0 left-0 top-0 z-10 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-white/[0.1] before:content-[''] hover:before:bg-white/[0.22] focus-visible:ring-1 focus-visible:ring-white/25"
                          onPointerDown={handlePlanningResizePointerDown}
                          onDoubleClick={handlePlanningResizeDoubleClick}
                        />
                      ) : null}
                      <div
                        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
                        style={{
                          width: isFullscreenPlanTab ? '100%' : planPanelWidth,
                        }}
                      >
                        <PlanningPanel
                          project={project}
                          layout={isFullscreenPlanTab ? 'fullscreen' : 'sidebar'}
                          sessions={planningSessions}
                          activeSessionId={planningPanelActiveSessionId}
                          onActiveSessionChange={handlePlanningActiveSessionChange}
                          onSessionsMutated={() => refreshPlanningSessions()}
                          onOpenInMainTab={handleOpenPlanningInMainTab}
                          onClose={handlePlanningPanelClose}
                          onLocalProjectRefresh={refreshPlanningRelatedProjectState}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  key={project.id}
                  className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
                  aria-hidden={activeTabId !== 'docs'}
                  style={{
                    visibility: activeTabId === 'docs' ? 'visible' : 'hidden',
                    pointerEvents: activeTabId === 'docs' ? 'auto' : 'none',
                    zIndex: activeTabId === 'docs' ? 1 : 0,
                  }}
                >
                  <PlanningDocsView
                    selectedPath={selectedPlanningDocPath}
                    fileRevision={planningDocFileRevision}
                    projectKind={project.kind}
                    cloudProjectId={project.kind === 'cloud' ? project.id : null}
                    planningDocFiles={planningDocFiles}
                    planningDocsCloudListMeta={planningDocsCloudListMeta}
                    planningDocsFirestoreStream={planningDocsFirestoreStream}
                    firebaseConfigured={isFirebaseConfigured()}
                    onPlanningDocsMutated={() => void refreshPlanningDocList()}
                    onDirtyChange={handlePlanningDocsDirtyChange}
                  />
                </div>
              </div>
            </div>
            {settingsRouteActive ? (
              <div className="absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden bg-[#09090b]">
                <div className="app-window-no-drag flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
                  <button
                    type="button"
                    onClick={() => replaceProjectWorkspaceRoute()}
                    className="rounded-md px-2 py-1 text-[12px] font-medium text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
                  >
                    ← Workspace
                  </button>
                </div>
                <ProjectSettingsView
                  project={project}
                  currentUid={uid}
                  currentUserDisplayName={displayName}
                  currentUserEmail={userEmail ?? undefined}
                  onAutoStartWhenUnblockedChange={handleAutoStartWhenUnblockedProjectChange}
                  onProjectAgentPrefsRefresh={refreshPlanningRelatedProjectState}
                  onCloudSharedReposChanged={(sharedRepos) => {
                    setProject((cur) =>
                      cur && cur.kind === 'cloud'
                        ? { ...cur, sharedRepos }
                        : cur,
                    );
                  }}
                />
              </div>
            ) : null}
          </div>
        </AppShell>
      </div>
      {deleteConfirmSession ? (
        <ConfirmDialog
          title="Delete task workspace?"
          description={`This will permanently remove the workspace for "${deleteConfirmSession.title}". The task itself will remain on the board.`}
          bullets={[
            'Kill the running agent session',
            'Close any terminals opened in this workspace',
            'Remove the git worktree and its branch from disk',
          ]}
          confirmLabel="Delete workspace"
          destructive
          onConfirm={() => void confirmDeleteWorkspace()}
          onCancel={cancelDeleteWorkspace}
        />
      ) : null}
      {cleanupConfirmTask ? (
        <ConfirmDialog
          title="Clean up task workspace?"
          description={`This tears down the agent workspace for "${cleanupConfirmTask.title}". The task stays in Done on the board.`}
          bullets={[
            'Stop any running agent session for this task',
            'Close terminals opened in this workspace',
            'Remove the git worktree from disk',
          ]}
          confirmLabel="Clean up"
          destructive={false}
          onConfirm={() => void confirmCleanupTask()}
          onCancel={cancelCleanupTask}
        />
      ) : null}
      {taskDeleteConfirmTask ? (
        <ConfirmDialog
          title="Delete task and workspace?"
          description={`This removes "${taskDeleteConfirmTask.title}" from the board and tears down its Flux workspace.`}
          bullets={[
            'Remove the task from the board',
            'End agent sessions tied to this task (running agents stop)',
            'Close terminals opened in those workspaces',
            'Remove the git worktree from disk when one exists',
          ]}
          confirmLabel="Delete task"
          destructive
          onConfirm={() => void confirmTaskDelete()}
          onCancel={cancelTaskDeleteConfirm}
        />
      ) : null}
      {cloudPlanningDocsSeedModal}
    </div>
  );
}

function findRemoteRunner(
  byUid: Map<string, RunnerEntry> | undefined,
  selfUid: string | null,
  projectMembers?: ProjectMember[],
): { uid: string; displayName?: string; photoURL?: string } | null {
  if (!byUid) return null;
  const STALE_MS = 2 * 60 * 1000;
  const now = Date.now();
  for (const entry of byUid.values()) {
    if (entry.status !== 'running') continue;
    if (selfUid && entry.uid === selfUid) continue;
    const seen = Date.parse(entry.lastSeen);
    if (Number.isFinite(seen) && now - seen > STALE_MS) continue;
    const member = projectMembers?.find((m) => m.uid === entry.uid);
    return {
      uid: entry.uid,
      displayName: entry.displayName ?? member?.displayName,
      photoURL: entry.photoURL ?? member?.photoURL,
    };
  }
  return null;
}
