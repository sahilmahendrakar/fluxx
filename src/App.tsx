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
import { useInvites } from './renderer/invites/useInvites';
import {
  useAgentHeartbeat,
  useRunners,
} from './renderer/runners/useRunners';
import type { TaskPatch, TaskProvider } from './renderer/tasks/TaskProvider';
import { LocalTaskProvider } from './renderer/tasks/LocalTaskProvider';
import { FirestoreTaskProvider } from './renderer/tasks/FirestoreTaskProvider';
import { keyForInsert, sortColumn } from './renderer/tasks/orderKey';

type ActiveProject = LocalProject | CloudProject;

const UPDATE_DEBOUNCE_MS = 300;
const STATIC_TAB_IDS = new Set(['board', 'plan', 'docs', 'settings']);
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
  const [openTabIds, setOpenTabIds] = useState<Set<string>>(() => new Set());
  const [settingsTabOpen, setSettingsTabOpen] = useState(false);
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

  const auth = useAuth();
  const uid = auth.user?.uid ?? null;
  const userEmail = auth.user?.email ?? null;
  const displayName = auth.user?.displayName ?? undefined;
  const cloudProjectsState = useCloudProjects(uid);
  const invitesState = useInvites(userEmail);

  const cloudProjectId = project?.kind === 'cloud' ? project.id : null;
  const runners = useRunners(cloudProjectId);
  useAgentHeartbeat({ projectId: cloudProjectId, uid, displayName });

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

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
      setProject({
        id: match.id,
        kind: 'cloud',
        name: match.name,
        ownerId: match.ownerId,
        memberIds: match.memberIds,
        createdAt: match.createdAt,
        rootPath: binding.rootPath,
      });
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
      setOpenTabIds(new Set());
      setActiveTabId('board');
      setPlanningSessions([]);
      setPlanningSidebarActiveId(null);
      setOpenPlanningMainTabIds(new Set());
      return;
    }
    setSessions((prev) => prev.filter((s) => s.projectId === project.id));
    setActiveTabId((prev) => (STATIC_TAB_IDS.has(prev) ? prev : 'board'));

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
        if (
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
    Map<string, { patch: TaskPatch; timer: ReturnType<typeof setTimeout> }>
  >(new Map());

  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const { timer } of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const flushUpdate = useCallback(
    async (id: string) => {
      if (!provider) return;
      const pending = pendingRef.current.get(id);
      if (!pending) return;
      pendingRef.current.delete(id);
      try {
        const updated = await provider.update(id, pending.patch);
        const newer = pendingRef.current.get(id);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === id ? { ...updated, ...(newer?.patch ?? {}) } : t,
          ),
        );
      } catch (err) {
        console.error('[tasks.update] failed', err);
      }
    },
    [provider],
  );

  const handleUpdateTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

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
      if (Object.keys(persistable).length === 0) return;

      const existing = pendingRef.current.get(id);
      if (existing) clearTimeout(existing.timer);
      const merged: TaskPatch = { ...existing?.patch, ...persistable };
      const timer = setTimeout(() => {
        void flushUpdate(id);
      }, UPDATE_DEBOUNCE_MS);
      pendingRef.current.set(id, { patch: merged, timer });
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

      setTasks((prev) =>
        prev.map((t) =>
          t.id === draggableId
            ? { ...t, status: nextStatus, orderKey: nextOrderKey }
            : t,
        ),
      );

      try {
        const updated = await provider.update(draggableId, {
          status: nextStatus,
          orderKey: nextOrderKey,
        });
        const pending = pendingRef.current.get(draggableId);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === draggableId
              ? { ...updated, ...(pending?.patch ?? {}) }
              : t,
          ),
        );
      } catch (err) {
        console.error('[tasks.update] drag-end failed', err);
      }
    },
    [provider, tasks],
  );

  const handleCreateTask = useCallback(
    async (title: string, agent: Agent) => {
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
        const task = await provider.create({ title, agent, orderKey });
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
    setActiveTabId('docs');
    setPlanPanelOpen(false);
    setDocsSidebarExpanded(true);
  }, []);

  const handleDocsSidebarExpandToggle = useCallback(() => {
    setDocsSidebarExpanded((v) => !v);
  }, []);

  const handleSelectPlanningDoc = useCallback((relativePath: string) => {
    setSelectedPlanningDocPath(relativePath);
    setActiveTabId('docs');
    setPlanPanelOpen(false);
  }, []);

  useEffect(() => {
    if (activeTabId === 'docs' || activeTabId === 'settings') {
      setPlanPanelOpen(false);
    }
  }, [activeTabId]);

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

  const handleOpenSettingsTab = useCallback(() => {
    setSettingsTabOpen(true);
    setActiveTabId('settings');
  }, []);

  const handleCloseSettingsTab = useCallback(() => {
    setSettingsTabOpen(false);
    setActiveTabId((prev) => (prev === 'settings' ? 'board' : prev));
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

  const fullscreenPlanningSessionId =
    activeTabId === 'plan'
      ? planningSidebarActiveId
      : parsePlanTabId(activeTabId);

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

  const remoteRunnerForSelected =
    selectedTask && cloudProjectId
      ? findRemoteRunner(runners.byTask.get(selectedTask.id), uid)
      : null;

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
          onSelectTab={setActiveTabId}
          onOpenSettings={handleOpenSettingsTab}
          collapsed={sidebarCollapsed}
          onCollapse={handleCollapseSidebar}
          onExpand={handleExpandSidebar}
          planPanelOpen={planPanelOpen}
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
              settingsTabOpen={settingsTabOpen}
              onSelectTab={setActiveTabId}
              onCloseSessionTab={handleCloseSessionTab}
              onSelectPlanningTab={(sessionId) => setActiveTabId(planTabId(sessionId))}
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
              return (
                <div
                  key={item.session.id}
                  aria-hidden={!isActive}
                  className="absolute inset-0 flex min-h-0 flex-col"
                  style={{
                    visibility: isActive ? 'visible' : 'hidden',
                    pointerEvents: isActive ? 'auto' : 'none',
                    zIndex: isActive ? 1 : 0,
                  }}
                >
                  <SessionTerminalView session={item.session} visible={isActive} />
                </div>
              );
            })}
            {!activeSessionTab && activeTabId === 'board' ? (
              <div className="relative flex min-h-0 flex-1 overflow-hidden">
                <div
                  ref={boardRowRef}
                  className="flex min-h-0 flex-1 overflow-hidden"
                >
                  <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <Board
                      tasks={sortedTasks}
                      onDragEnd={handleDragEnd}
                      onCreateTask={handleCreateTask}
                      onDeleteTask={handleDeleteTask}
                      onRequestCleanupTask={requestCleanupTask}
                      cleanupLoadingTaskId={cleanupLoadingTaskId}
                      onCardClick={(id) => setSelectedTaskId(id)}
                      planPanelOpen={planPanelOpen}
                      onTogglePlanPanel={() => {
                        setActiveTabId('board');
                        setPlanPanelOpen((v) => !v);
                      }}
                    />
                    <TaskDetailPanel
                      task={selectedTask}
                      onClose={() => setSelectedTaskId(null)}
                      onUpdate={handleUpdateTask}
                      onDelete={handleDeleteTask}
                      remoteRunner={remoteRunnerForSelected}
                      onOpenSessionTab={handleOpenSessionTab}
                      onArchiveSession={(id) => void handleArchiveSession(id)}
                    />
                  </div>
                  <div
                    className={`relative flex shrink-0 flex-col overflow-hidden ${
                      planPanelOpen ? '' : 'pointer-events-none'
                    }`}
                    style={{ width: planPanelOpen ? planPanelWidth : 0 }}
                  >
                    {planPanelOpen ? (
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
                      style={{ width: planPanelWidth }}
                    >
                      <PlanningPanel
                        project={project}
                        layout="sidebar"
                        sessions={planningSessions}
                        activeSessionId={planningSidebarActiveId}
                        onActiveSessionChange={setPlanningSidebarActiveId}
                        onSessionsMutated={() => refreshPlanningSessions()}
                        onOpenInMainTab={handleOpenPlanningInMainTab}
                        onClose={() => setPlanPanelOpen(false)}
                        onLocalProjectRefresh={
                          project.kind === 'local'
                            ? async () => {
                                const p = await window.electronAPI.project.get();
                                if (p) setProject(p);
                              }
                            : undefined
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : !activeSessionTab &&
              (activeTabId === 'plan' || parsePlanTabId(activeTabId) !== null) ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <PlanningPanel
                  project={project}
                  layout="fullscreen"
                  sessions={planningSessions}
                  activeSessionId={fullscreenPlanningSessionId}
                  onActiveSessionChange={(id) => {
                    if (activeTabId === 'plan') {
                      setPlanningSidebarActiveId(id);
                      return;
                    }
                    const cur = parsePlanTabId(activeTabId);
                    if (id && id !== cur) {
                      setOpenPlanningMainTabIds((prev) => {
                        const next = new Set(prev);
                        if (cur) next.delete(cur);
                        next.add(id);
                        return next;
                      });
                      setActiveTabId(planTabId(id));
                    }
                  }}
                  onSessionsMutated={() => refreshPlanningSessions()}
                  onClose={() => {
                    const sid = parsePlanTabId(activeTabId);
                    if (sid) {
                      void handleClosePlanningMainTab(sid);
                      return;
                    }
                    setActiveTabId('board');
                    setPlanPanelOpen(false);
                  }}
                  onLocalProjectRefresh={
                    project.kind === 'local'
                      ? async () => {
                          const p = await window.electronAPI.project.get();
                          if (p) setProject(p);
                        }
                      : undefined
                  }
                />
              </div>
            ) : !activeSessionTab && activeTabId === 'docs' ? (
              <PlanningDocsView
                key={project.id}
                selectedPath={selectedPlanningDocPath}
                fileRevision={planningDocFileRevision}
              />
            ) : !activeSessionTab && activeTabId === 'settings' ? (
              <ProjectSettingsView
                project={project}
                currentUid={uid}
                currentUserDisplayName={displayName}
                currentUserEmail={userEmail ?? undefined}
              />
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
  byUid: Map<string, { uid: string; status: string; lastSeen: string; displayName?: string }> | undefined,
  selfUid: string | null,
): { displayName?: string } | null {
  if (!byUid) return null;
  const STALE_MS = 2 * 60 * 1000;
  const now = Date.now();
  for (const entry of byUid.values()) {
    if (entry.status !== 'running') continue;
    if (selfUid && entry.uid === selfUid) continue;
    const seen = Date.parse(entry.lastSeen);
    if (Number.isFinite(seen) && now - seen > STALE_MS) continue;
    return { displayName: entry.displayName };
  }
  return null;
}
