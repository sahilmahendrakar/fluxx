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
  Task,
  TaskStatus,
  Agent,
  CloudProject,
  LocalProject,
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
import { TeamView } from './components/TeamView';
import type { WorkspaceNavView } from './components/Sidebar';
import { useAuth } from './renderer/auth/useAuth';
import { useCloudProjects } from './renderer/projects/useCloudProjects';
import { useInvites } from './renderer/invites/useInvites';
import {
  useAgentHeartbeat,
  useRunners,
} from './renderer/runners/useRunners';
import type { TaskProvider } from './renderer/tasks/TaskProvider';
import { LocalTaskProvider } from './renderer/tasks/LocalTaskProvider';
import { FirestoreTaskProvider } from './renderer/tasks/FirestoreTaskProvider';
import { keyForInsert, sortColumn } from './renderer/tasks/orderKey';

type TaskPatch = Partial<
  Pick<Task, 'title' | 'status' | 'agent' | 'description' | 'orderKey'>
>;
type ActiveProject = LocalProject | CloudProject;

const UPDATE_DEBOUNCE_MS = 300;

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
  const [workspaceView, setWorkspaceView] = useState<WorkspaceNavView>('board');
  const [planPanelOpen, setPlanPanelOpen] = useState(false);
  const [planPanelWidth, setPlanPanelWidth] = useState(DEFAULT_PLANNING_PANEL_WIDTH);
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

  const shouldLoadPlanningDocs = docsSidebarExpanded || workspaceView === 'docs';

  useEffect(() => {
    if (!project || !shouldLoadPlanningDocs) return;
    void refreshPlanningDocList();
  }, [project?.id, shouldLoadPlanningDocs, refreshPlanningDocList]);

  useEffect(() => {
    if (workspaceView !== 'docs') return;
    if (selectedPlanningDocPath != null) return;
    if (planningDocFiles.length > 0) {
      setSelectedPlanningDocPath(planningDocFiles[0].relativePath);
    }
  }, [workspaceView, selectedPlanningDocPath, planningDocFiles]);

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
    if (!docsSidebarExpanded && workspaceView !== 'docs') return;
    const unsub = window.electronAPI.planningDocs.onChanged(() => {
      void refreshPlanningDocList();
      if (workspaceView === 'docs') {
        setPlanningDocFileRevision((n) => n + 1);
      }
    });
    return unsub;
  }, [
    project?.id,
    docsSidebarExpanded,
    workspaceView,
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
      if (patch.orderKey !== undefined) persistable.orderKey = patch.orderKey;
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

  const handleDeleteTask = useCallback(
    async (id: string) => {
      if (!provider) return;
      const pending = pendingRef.current.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRef.current.delete(id);
      }
      try {
        await provider.delete(id);
        setTasks((prev) => prev.filter((t) => t.id !== id));
        setSelectedTaskId((sid) => (sid === id ? null : sid));
      } catch (err) {
        console.error('[tasks.delete] failed', err);
      }
    },
    [provider],
  );

  const handleProjectActivated = useCallback((p: ActiveProject) => {
    setProject(p);
    setSelectedTaskId(null);
    setPlanPanelOpen(false);
    setWorkspaceView('board');
    setDocsSidebarExpanded(false);
    setPlanningDocFiles([]);
    setPlanningDocsListError(null);
    setSelectedPlanningDocPath(null);
    setPlanningDocFileRevision(0);
  }, []);

  const handleClearProject = useCallback(async () => {
    await window.electronAPI.projects.clearActive();
    setProject(null);
    setTasks([]);
    setSelectedTaskId(null);
    setPlanPanelOpen(false);
    setWorkspaceView('board');
    setDocsSidebarExpanded(false);
    setPlanningDocFiles([]);
    setPlanningDocsListError(null);
    setSelectedPlanningDocPath(null);
    setPlanningDocFileRevision(0);
  }, []);

  const handlePlanNav = useCallback(() => {
    if (workspaceView !== 'board') {
      setWorkspaceView('board');
      setPlanPanelOpen(true);
    } else {
      setPlanPanelOpen((v) => !v);
    }
  }, [workspaceView]);

  const handleDocsNav = useCallback(() => {
    setWorkspaceView('docs');
    setPlanPanelOpen(false);
    setDocsSidebarExpanded(true);
  }, []);

  const handleDocsSidebarExpandToggle = useCallback(() => {
    setDocsSidebarExpanded((v) => !v);
  }, []);

  const handleSelectPlanningDoc = useCallback((relativePath: string) => {
    setSelectedPlanningDocPath(relativePath);
    setWorkspaceView('docs');
    setPlanPanelOpen(false);
  }, []);

  useEffect(() => {
    if (workspaceView === 'team' || workspaceView === 'docs') {
      setPlanPanelOpen(false);
    }
  }, [workspaceView]);

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

  const inProgressCount = tasks.filter((t) => t.status === 'in-progress').length;
  const needsInputCount = tasks.filter((t) => t.status === 'needs-input').length;
  const statusLine = `${inProgressCount} in progress · ${needsInputCount} needs input`;

  const topBarTitle =
    workspaceView === 'docs'
      ? 'Planning docs'
      : workspaceView === 'board'
        ? 'Board'
        : 'Team';

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
        <AppShell
          project={project}
          onClearProject={() => void handleClearProject()}
          workspaceView={workspaceView}
          onWorkspaceViewChange={setWorkspaceView}
          onPlanNavClick={handlePlanNav}
          onDocsNavClick={handleDocsNav}
          docsSidebarExpanded={docsSidebarExpanded}
          onDocsSidebarExpandToggle={handleDocsSidebarExpandToggle}
          planningDocFiles={planningDocFiles}
          planningDocsListLoading={planningDocsListLoading}
          planningDocsListError={planningDocsListError}
          selectedPlanningDocPath={selectedPlanningDocPath}
          onSelectPlanningDoc={handleSelectPlanningDoc}
          planPanelOpen={planPanelOpen}
        >
          <TopBar project={project} title={topBarTitle} statusLine={statusLine} />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {workspaceView === 'board' ? (
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
                      onCardClick={(id) => setSelectedTaskId(id)}
                      planPanelOpen={planPanelOpen}
                      onTogglePlanPanel={() => setPlanPanelOpen((v) => !v)}
                    />
                    <TaskDetailPanel
                      task={selectedTask}
                      onClose={() => setSelectedTaskId(null)}
                      onUpdate={handleUpdateTask}
                      onDelete={handleDeleteTask}
                      remoteRunner={remoteRunnerForSelected}
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
            ) : workspaceView === 'team' && project.kind === 'cloud' && uid ? (
              <TeamView
                project={project}
                currentUid={uid}
                currentUserDisplayName={displayName}
                currentUserEmail={userEmail ?? undefined}
              />
            ) : workspaceView === 'docs' ? (
              <PlanningDocsView
                key={project.id}
                selectedPath={selectedPlanningDocPath}
                fileRevision={planningDocFileRevision}
              />
            ) : null}
          </div>
        </AppShell>
      </div>
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
