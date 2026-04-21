import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DropResult } from '@hello-pangea/dnd';
import {
  Task,
  TaskStatus,
  Agent,
  CloudProject,
  LocalProject,
  Session,
} from './types';
import Board from './components/Board';
import TaskDetailPanel from './components/TaskDetailPanel';
import { AppShell } from './components/AppShell';
import { TopBar } from './components/TopBar';
import { LoadingScreen } from './components/LoadingScreen';
import { ProjectsListView } from './components/ProjectsListView';
import { SignInCard } from './components/SignInCard';
import { TeamView } from './components/TeamView';
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
import type { TaskProvider } from './renderer/tasks/TaskProvider';
import { LocalTaskProvider } from './renderer/tasks/LocalTaskProvider';
import { FirestoreTaskProvider } from './renderer/tasks/FirestoreTaskProvider';
import { keyForInsert, sortColumn } from './renderer/tasks/orderKey';

type TaskPatch = Partial<
  Pick<Task, 'title' | 'status' | 'agent' | 'description' | 'orderKey'>
>;
type ActiveProject = LocalProject | CloudProject;

const UPDATE_DEBOUNCE_MS = 300;
const STATIC_TAB_IDS = new Set(['board', 'plan', 'team']);

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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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
    if (!project) {
      setSessions([]);
      setOpenTabIds(new Set());
      setActiveTabId('board');
      return;
    }
    setSessions((prev) => prev.filter((s) => s.projectId === project.id));
    setActiveTabId((prev) => (STATIC_TAB_IDS.has(prev) ? prev : 'board'));
  }, [project?.id]);

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
        const removed = sessions.find((s) => s.taskId === id);
        if (removed) {
          setSessions((prev) => prev.filter((s) => s.taskId !== id));
          setOpenTabIds((prev) => {
            if (!prev.has(removed.id)) return prev;
            const next = new Set(prev);
            next.delete(removed.id);
            return next;
          });
          setActiveTabId((prev) => (prev === removed.id ? 'board' : prev));
        }
      } catch (err) {
        console.error('[tasks.delete] failed', err);
      }
    },
    [provider, sessions],
  );

  const handleProjectActivated = useCallback((p: ActiveProject) => {
    setProject(p);
    setSelectedTaskId(null);
  }, []);

  const handleClearProject = useCallback(async () => {
    await window.electronAPI.projects.clearActive();
    setProject(null);
    setTasks([]);
    setSelectedTaskId(null);
    setSessions([]);
    setOpenTabIds(new Set());
    setActiveTabId('board');
  }, []);

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
    if (STATIC_TAB_IDS.has(activeTabId)) return null;
    return sessionItems.find((t) => t.session.id === activeTabId) ?? null;
  }, [activeTabId, sessionItems]);

  const deleteConfirmSession = useMemo(
    () => (deleteConfirmId ? sessionItems.find((s) => s.session.id === deleteConfirmId) ?? null : null),
    [deleteConfirmId, sessionItems],
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
        <AppShell
          project={project}
          onClearProject={() => void handleClearProject()}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          sessions={sessionItems}
          onOpenSession={handleOpenSessionFromSidebar}
          onArchiveSession={(id) => void handleArchiveSession(id)}
          onDeleteWorkspace={requestDeleteWorkspace}
        >
          <TopBar project={project} statusLine={statusLine}>
            <TabBar
              activeTabId={activeTabId}
              openSessions={openTabItems}
              onSelectTab={setActiveTabId}
              onCloseSessionTab={handleCloseSessionTab}
            />
          </TopBar>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeSessionTab ? (
              <SessionTerminalView session={activeSessionTab.session} />
            ) : activeTabId === 'board' ? (
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <Board
                  tasks={sortedTasks}
                  onDragEnd={handleDragEnd}
                  onCreateTask={handleCreateTask}
                  onDeleteTask={handleDeleteTask}
                  onCardClick={(id) => setSelectedTaskId(id)}
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
            ) : activeTabId === 'team' && project.kind === 'cloud' && uid ? (
              <TeamView
                project={project}
                currentUid={uid}
                currentUserDisplayName={displayName}
                currentUserEmail={userEmail ?? undefined}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-sm font-medium text-zinc-300">Plan</p>
                <p className="max-w-sm text-sm text-zinc-500">
                  Planning assistant coming soon.
                </p>
              </div>
            )}
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
