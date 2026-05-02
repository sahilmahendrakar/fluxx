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
  Task,
  TaskStatus,
  Agent,
  CloudProject,
  LocalProject,
  Session,
  type ActiveProjectKey,
  type PlanningSession,
  type ProjectTabState,
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
import { keyForInsert, sortColumn } from './renderer/tasks/orderKey';
import { normalizeTaskLabels } from './taskLabels';
import { invalidateSessionAttachCache } from './terminal/warmAttach';
import { isTaskBlocked } from './taskDependencies';
import { useMcpRendererBridge } from './renderer/mcp/useMcpRendererBridge';
import { maybeCloudAutoStartSessionOnInProgressTransition } from './cloudInProgressAutostartApply';
import { runCloudDoneTransitionFollowUp } from './cloudTaskDoneFollowUp';
import { applyUnblockAutostartForCompletedBlocker } from './unblockAutostartApply';
import type { UnblockAutostartPolicy } from './unblockAutostart';
import {
  defaultTaskAgentForProject,
  hydrateCloudProject,
} from './cloudBindingPrefs';
import { mergeMemberPhotoURL } from './renderer/projects/cloudProjects';
import {
  leaveSettingsIfActive,
  pushProjectSettingsRoute,
  readProjectHashRoute,
  replaceProjectWorkspaceRoute,
  useProjectHashRoute,
} from './projectHashRoute';

type ActiveProject = LocalProject | CloudProject;

const UPDATE_DEBOUNCE_MS = 300;
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
  const { assigneeId, workspaceCleanedAt, ...rest } = patch;
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
  return next;
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('flux.sidebarCollapsed') === '1';
    } catch {
      return false;
    }
  });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [cleanupConfirmTaskId, setCleanupConfirmTaskId] = useState<string | null>(null);
  const [cleanupLoadingTaskId, setCleanupLoadingTaskId] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [planPanelOpen, setPlanPanelOpen] = useState(false);
  const [planPanelWidth, setPlanPanelWidth] = useState(DEFAULT_PLANNING_PANEL_WIDTH);
  const [planningSessions, setPlanningSessions] = useState<PlanningSession[]>([]);
  const [planningSidebarActiveId, setPlanningSidebarActiveId] = useState<string | null>(
    null,
  );
  const [openPlanningMainTabIds, setOpenPlanningMainTabIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [docsSidebarExpanded, setDocsSidebarExpanded] = useState(false);
  const [planningDocFiles, setPlanningDocFiles] = useState<{ relativePath: string }[]>(
    [],
  );
  const [planningDocsListLoading, setPlanningDocsListLoading] = useState(false);
  const [planningDocsListError, setPlanningDocsListError] = useState<string | null>(
    null,
  );
  const [selectedPlanningDocPath, setSelectedPlanningDocPath] = useState<
    string | null
  >(null);
  const [planningDocFileRevision, setPlanningDocFileRevision] = useState(0);
  const boardRowRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;
  const uidRef = useRef<string | null>(null);
  const cloudUnblockTasksPrevRef = useRef<Task[] | null>(null);
  const cloudUnblockInFlightRef = useRef<Set<string>>(new Set());
  /** Skips duplicate unblock handling in the cloud snapshot effect while we finalize Done inline. */
  const cloudInlineDoneFollowUpTaskIdsRef = useRef<Set<string>>(new Set());
  const memberPhotoRefreshKeyRef = useRef('');
  const [autoStartWhenUnblockedProject, setAutoStartWhenUnblockedProject] = useState(false);

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
  const membersState = useMembers(cloudProjectId);
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
        setPlanningDocsListError(
          result.error === 'NO_PROJECT'
            ? 'No workspace open.'
            : 'Could not read the planning folder.',
        );
        return;
      }
      setPlanningDocFiles(result.files);
    } catch {
      setPlanningDocFiles([]);
      setPlanningDocsListError('Failed to load documents.');
    } finally {
      setPlanningDocsListLoading(false);
    }
  }, []);

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

  // ----- Task provider per active project -----
  const provider = useMemo<TaskProvider | null>(() => {
    if (!project) return null;
    if (project.kind === 'local') return new LocalTaskProvider();
    if (!uid) return null;
    return new FirestoreTaskProvider(project.id, uid);
  }, [project?.kind, project?.id, uid]);

  useEffect(() => {
    if (!provider) {
      setTasks([]);
      return;
    }
    const unsub = provider.subscribe((all) => setTasks(all));
    return () => unsub();
  }, [provider]);

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
          startSession: (task, all) => window.electronAPI.sessions.start(task, all),
          moveBacklogToInProgress: async (id) => {
            const task = tasksRef.current.find((x) => x.id === id);
            const patch: TaskPatch = { status: 'in-progress' };
            if (uidRef.current && !task?.assigneeId) patch.assigneeId = uidRef.current;
            const updated = await provider.update(id, patch);
            if (inProg) {
              const all = tasksRef.current.map((x) => (x.id === id ? updated : x));
              const r = await window.electronAPI.sessions.start(updated, all);
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
            const r = await window.electronAPI.sessions.start(updated, all);
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
      const result = await window.electronAPI.projects.activateCloud({
        id: match.id,
        rootPath: binding.rootPath,
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

  // Keep cloud project's Firestore-side fields fresh when the snapshot updates.
  useEffect(() => {
    if (!project || project.kind !== 'cloud') return;
    if (cloudProjectsState.status !== 'ready') return;
    const fresh = cloudProjectsState.projects.find((p) => p.id === project.id);
    if (!fresh) return;
    const changed =
      fresh.name !== project.name ||
      fresh.ownerId !== project.ownerId ||
      fresh.memberIds.join(',') !== project.memberIds.join(',') ||
      fresh.createdAt !== project.createdAt;
    if (!changed) return;
    setProject({ ...project, ...fresh });
  }, [project, cloudProjectsState.status, cloudProjectsState.projects]);

  useEffect(() => {
    const unsub = window.electronAPI.sessions.onExit((exited) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === exited.id ? { ...s, status: exited.status } : s)),
      );
    });
    return () => unsub();
  }, []);

  // Silence-based needs-input detection: subscribe to agent-state for running sessions.
  useEffect(() => {
    const running = sessions.filter((s) => s.status === 'running');
    const unsubs = running.map((s) =>
      window.electronAPI.sessions.onAgentState(s.id, (state) => {
        const taskId = s.taskId;
        if (!taskId) return;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            if (state === 'silent' && t.status === 'in-progress') {
              return { ...t, status: 'needs-input' };
            }
            if (state === 'active' && t.status === 'needs-input') {
              return { ...t, status: 'in-progress' };
            }
            return t;
          }),
        );
        // Persist to backend (local or cloud).
        if (state === 'silent') {
          provider?.update(taskId, { status: 'needs-input' });
        } else if (state === 'active') {
          provider?.update(taskId, { status: 'in-progress' });
        }
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [sessions, provider]);

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
      setSessions((prev) => {
        const i = prev.findIndex((x) => x.id === s.id);
        if (i >= 0) {
          const next = prev.slice();
          next[i] = s;
          return next;
        }
        return [...prev, s];
      });
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
      setSessions([]);
      setSessionStartPendingTaskIds(new Set());
      setOpenTabIds(new Set());
      setActiveTabId('board');
      setPlanningSessions([]);
      setPlanningSidebarActiveId(null);
      setOpenPlanningMainTabIds(new Set());
      return;
    }
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

        const persisted = await window.electronAPI.projects.getTabs(projectKey);
        if (cancelled) return;
        const aliveIds = new Set(projectSessions.map((s) => s.id));
        const restoredOpen = persisted.openTaskIds.filter((id) =>
          aliveIds.has(id),
        );
        setOpenTabIds(new Set(restoredOpen));
        setOpenPlanningMainTabIds(new Set(persisted.openPlanningTabIds ?? []));
        setPlanningSidebarActiveId(persisted.planningSidebarActiveSessionId ?? null);
        if (persisted.activeTaskId === 'settings') {
          setActiveTabId('board');
          pushProjectSettingsRoute();
        } else if (
          persisted.activeTaskId &&
          (STATIC_TAB_IDS.has(persisted.activeTaskId) ||
            persisted.activeTaskId.startsWith(PLAN_TAB_PREFIX) ||
            aliveIds.has(persisted.activeTaskId))
        ) {
          setActiveTabId(persisted.activeTaskId);
        }
      } catch (err) {
        console.error('[App] restore tabs failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id, project?.kind]);

  // Persist tab strip whenever it changes for the active project.
  useEffect(() => {
    if (!project) return;
    const projectKey: ActiveProjectKey = { kind: project.kind, id: project.id };
    const tabs: ProjectTabState = {
      openTaskIds: Array.from(openTabIds),
      activeTaskId: activeTabId,
      openPlanningTabIds: Array.from(openPlanningMainTabIds),
      planningSidebarActiveSessionId: planningSidebarActiveId,
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
  ]);

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

  useMcpRendererBridge({
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
          const mergedTask = mergeServerTaskWithPendingPatch(updated, newer?.patch);
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
                  prev.map((t) => (t.id === follow.task.id ? follow.task : t)),
                );
                rowLocked = true;
              }
            }
          } else {
            maybeStripSessionsAfterNewWorkspaceClean(preFlushTask, mergedTask);
          }
          if (!rowLocked) {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === id ? mergeServerTaskWithPendingPatch(updated, newer?.patch) : t,
              ),
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
    (id: string, patch: Partial<Task>) => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          let next: Task = { ...t, ...patch };
          if (patch.labels !== undefined) {
            const n = normalizeTaskLabels(patch.labels);
            if (n.length > 0) {
              next = { ...next, labels: n };
            } else {
              next = { ...next };
              delete next.labels;
            }
          }
          if (patch.autoStartOnUnblock !== undefined) {
            if (patch.autoStartOnUnblock) {
              next = { ...next, autoStartOnUnblock: true };
            } else {
              next = { ...next };
              delete next.autoStartOnUnblock;
            }
          }
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
      if (patch.autoStartOnUnblock !== undefined) {
        persistable.autoStartOnUnblock = patch.autoStartOnUnblock;
      }
      if (patch.assigneeId !== undefined) {
        persistable.assigneeId = patch.assigneeId;
      }
      if (Object.keys(persistable).length === 0) return;

      const existing = pendingRef.current.get(id);
      if (existing) clearTimeout(existing.timer);
      const preFlushTask =
        existing?.preFlushTask ?? tasksRef.current.find((t) => t.id === id);
      if (!preFlushTask) return;
      const merged: TaskPatch = { ...existing?.patch, ...persistable };
      const timer = setTimeout(() => {
        void flushUpdate(id);
      }, UPDATE_DEBOUNCE_MS);
      pendingRef.current.set(id, { patch: merged, timer, preFlushTask });
    },
    [flushUpdate],
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
            const merged = mergeServerTaskWithPendingPatch(updated, pending?.patch);
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
                    prev.map((t) => (t.id === follow.task.id ? follow.task : t)),
                  );
                  rowLocked = true;
                }
              }
            } else {
              maybeStripSessionsAfterNewWorkspaceClean(previous, merged);
            }
            if (!rowLocked) {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === draggableId
                    ? mergeServerTaskWithPendingPatch(updated, pending?.patch)
                    : t,
                ),
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
            const allAfter = tasksRef.current.map((t) => (t.id === taskId ? updated : t));
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
                prev.map((t) => (t.id === follow.task.id ? follow.task : t)),
              );
              rowLocked = true;
            }
          } else {
            maybeStripSessionsAfterNewWorkspaceClean(task, updated);
          }
          if (!rowLocked) {
            setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
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
    async (title: string, agent: Agent, labelInput?: string[], assigneeId?: string) => {
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
        const task = await provider.create({
          title,
          agent,
          orderKey,
          ...(labels.length > 0 ? { labels } : {}),
          ...(assigneeId ? { assigneeId } : {}),
        });
        setTasks((prev) => {
          if (prev.some((t) => t.id === task.id)) return prev;
          return [...prev, task];
        });
      } catch (err) {
        console.error('[tasks.create] failed', err);
      }
    },
    [provider, tasks],
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

  const requestCleanupTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status !== 'done' || task.workspaceCleanedAt) return;
      setCleanupError(null);
      setCleanupConfirmTaskId(taskId);
    },
    [tasks],
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
          setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
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
    setCleanupConfirmTaskId(null);
    setCleanupLoadingTaskId(null);
    setCleanupError(null);
    setPlanPanelOpen(false);
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
    setCleanupConfirmTaskId(null);
    setCleanupLoadingTaskId(null);
    setCleanupError(null);
    setPlanPanelOpen(false);
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

  const handlePlanNav = useCallback(() => {
    leaveSettingsIfActive();
    const routeSid = parsePlanTabId(activeTabId);
    if (routeSid) {
      setPlanningSidebarActiveId(routeSid);
      setPlanPanelOpen(true);
      setActiveTabId('board');
      return;
    }
    if (activeTabId === 'plan') {
      setActiveTabId('board');
      return;
    }
    if (activeTabId !== 'board') {
      setActiveTabId('board');
      setPlanPanelOpen(true);
      return;
    }
    if (!planPanelOpen) {
      setPlanPanelOpen(true);
    } else {
      setActiveTabId('plan');
      setPlanPanelOpen(false);
    }
  }, [activeTabId, planPanelOpen]);

  const handleDocsNav = useCallback(() => {
    leaveSettingsIfActive();
    setActiveTabId('docs');
    setPlanPanelOpen(false);
    setDocsSidebarExpanded(true);
  }, []);

  const handleDocsSidebarExpandToggle = useCallback(() => {
    setDocsSidebarExpanded((v) => !v);
  }, []);

  const handleSelectPlanningDoc = useCallback((relativePath: string) => {
    leaveSettingsIfActive();
    setSelectedPlanningDocPath(relativePath);
    setActiveTabId('docs');
    setPlanPanelOpen(false);
  }, []);

  useEffect(() => {
    if (activeTabId === 'docs') {
      setPlanPanelOpen(false);
    }
  }, [activeTabId]);

  useEffect(() => {
    if (settingsRouteActive) {
      setPlanPanelOpen(false);
    }
  }, [settingsRouteActive]);

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
    setActiveTabId(session.id);
    setSelectedTaskId(null);
  }, []);

  const handleOpenSessionFromSidebar = useCallback(
    (sessionId: string) => {
      leaveSettingsIfActive();
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;
      setOpenTabIds((prev) => {
        if (prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });
      setActiveTabId(sessionId);
      setSelectedTaskId(null);
    },
    [sessions],
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

  const handleOpenPlanningInMainTab = useCallback((sessionId: string) => {
    leaveSettingsIfActive();
    setOpenPlanningMainTabIds((prev) => new Set(prev).add(sessionId));
    setActiveTabId(planTabId(sessionId));
  }, []);

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
      setPlanPanelOpen(false);
      return;
    }
    setPlanPanelOpen(false);
  }, [activeTabId, handleClosePlanningMainTab]);

  const handleOpenSettingsTab = useCallback(() => {
    if (readProjectHashRoute() !== 'settings') {
      pushProjectSettingsRoute();
    }
  }, []);

  const handleCloseSettingsTab = useCallback(() => {
    replaceProjectWorkspaceRoute();
  }, []);

  const handleSelectWorkspaceTab = useCallback((tabId: string) => {
    if (tabId === 'settings') {
      if (readProjectHashRoute() !== 'settings') {
        pushProjectSettingsRoute();
      }
      return;
    }
    leaveSettingsIfActive();
    setActiveTabId(tabId);
  }, []);

  const handleSelectPlanningTabFromBar = useCallback((sessionId: string) => {
    leaveSettingsIfActive();
    setActiveTabId(planTabId(sessionId));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('flux.sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  const handleCollapseSidebar = useCallback(() => setSidebarCollapsed(true), []);
  const handleExpandSidebar = useCallback(() => setSidebarCollapsed(false), []);

  const handleArchiveSession = useCallback(async (sessionId: string) => {
    try {
      await window.electronAPI.sessions.archive(sessionId);
    } catch (err) {
      console.error('[session.archive] failed', err);
    }
    invalidateSessionAttachCache(sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setOpenTabIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    setActiveTabId((prev) => (prev === sessionId ? 'board' : prev));
  }, []);

  const handleDeleteWorkspace = useCallback(async (sessionId: string) => {
    try {
      await window.electronAPI.sessions.deleteWorkspace(sessionId);
    } catch (err) {
      console.error('[session.deleteWorkspace] failed', err);
    }
    invalidateSessionAttachCache(sessionId);
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
  const statusLine = `${inProgressCount} in progress · ${needsInputCount} needs input`;

  const sessionItems = useMemo(
    () => buildSessionTabs(sessions, tasks),
    [sessions, tasks],
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
        running: s?.status === 'running' ?? false,
      };
    });
  }, [openPlanningMainTabIds, planningSessions]);

  const isFullscreenPlanTab =
    activeTabId === 'plan' || parsePlanTabId(activeTabId) !== null;

  const isBoardOrPlanTab =
    activeTabId === 'board' || isFullscreenPlanTab;

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

  // Sort tasks per column for the board (orderKey-aware). Falls back to
  // createdAt/id for rows without a key.
  const sortedTasks = useMemo(() => {
    return [
      ...sortColumn(tasks, 'backlog'),
      ...sortColumn(tasks, 'in-progress'),
      ...sortColumn(tasks, 'needs-input'),
      ...sortColumn(tasks, 'done'),
    ];
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
          planningDocsListLoading={planningDocsListLoading}
          planningDocsListError={planningDocsListError}
          selectedPlanningDocPath={selectedPlanningDocPath}
          onSelectPlanningDoc={handleSelectPlanningDoc}
          sessions={sessionItems}
          onOpenSession={handleOpenSessionFromSidebar}
          onArchiveSession={(id) => void handleArchiveSession(id)}
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
                    markAsDoneBlocked={tabTaskBlocked}
                    onMarkAsDone={
                      tabTask && tabTask.status !== 'done' && !tabTaskBlocked
                        ? () => void handleMarkTaskDone(item.session.taskId, { goToBoard: true })
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
                        onDeleteTask={handleDeleteTask}
                        onRequestCleanupTask={requestCleanupTask}
                        cleanupLoadingTaskId={cleanupLoadingTaskId}
                        onCardClick={(id) => setSelectedTaskId(id)}
                        autoStartWhenUnblockedProject={autoStartWhenUnblockedProject}
                        onToggleTaskAutoStartOnUnblock={(id, enabled) =>
                          void handleUpdateTask(id, { autoStartOnUnblock: enabled })
                        }
                        planPanelOpen={planPanelOpen}
                        onTogglePlanPanel={() => {
                          leaveSettingsIfActive();
                          setActiveTabId('board');
                          setPlanPanelOpen((v) => !v);
                        }}
                        projectMembers={projectMembers}
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
                        onDelete={handleDeleteTask}
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
                        onOpenSessionTab={handleOpenSessionTab}
                        onArchiveSession={(id) => void handleArchiveSession(id)}
                        projectMembers={projectMembers}
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
                  className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
                  aria-hidden={activeTabId !== 'docs'}
                  style={{
                    visibility: activeTabId === 'docs' ? 'visible' : 'hidden',
                    pointerEvents: activeTabId === 'docs' ? 'auto' : 'none',
                    zIndex: activeTabId === 'docs' ? 1 : 0,
                  }}
                >
                  <PlanningDocsView
                    key={project.id}
                    selectedPath={selectedPlanningDocPath}
                    fileRevision={planningDocFileRevision}
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
                  onAutoStartWhenUnblockedChange={setAutoStartWhenUnblockedProject}
                  onProjectAgentPrefsRefresh={refreshPlanningRelatedProjectState}
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
