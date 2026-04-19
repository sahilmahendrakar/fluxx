import { useCallback, useEffect, useRef, useState } from 'react';
import { DropResult } from '@hello-pangea/dnd';
import { Task, TaskStatus, Agent, Project } from './types';
import Board from './components/Board';
import TaskDetailPanel from './components/TaskDetailPanel';
import { AppShell } from './components/AppShell';
import { TopBar } from './components/TopBar';
import { LoadingScreen } from './components/LoadingScreen';
import { WelcomeScreen } from './components/WelcomeScreen';
import type { WorkspaceNavView } from './components/Sidebar';

type TaskPatch = Partial<Pick<Task, 'title' | 'status' | 'agent' | 'description'>>;

const UPDATE_DEBOUNCE_MS = 300;

export default function App() {
  const isMac = window.electronAPI.platform === 'darwin';
  const [project, setProject] = useState<Project | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceNavView>('board');

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.electronAPI.project.get(),
      window.electronAPI.tasks.getAll(),
    ])
      .then(([proj, taskList]) => {
        if (cancelled) return;
        setProject(proj);
        setTasks(taskList);
        setProjectLoading(false);
      })
      .catch((err) => {
        console.error('[initial load] failed', err);
        if (!cancelled) setProjectLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const flushUpdate = useCallback(async (id: string) => {
    const pending = pendingRef.current.get(id);
    if (!pending) return;
    pendingRef.current.delete(id);
    try {
      const updated = await window.electronAPI.tasks.update(id, pending.patch);
      // Preserve any newer pending edits so a stale server result doesn't clobber them.
      const newer = pendingRef.current.get(id);
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...updated, ...(newer?.patch ?? {}) } : t)),
      );
    } catch (err) {
      console.error('[tasks.update] failed', err);
    }
  }, []);

  const handleUpdateTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

      const persistable: TaskPatch = {};
      if (patch.title !== undefined) persistable.title = patch.title;
      if (patch.description !== undefined) persistable.description = patch.description;
      if (patch.status !== undefined) persistable.status = patch.status;
      if (patch.agent !== undefined) persistable.agent = patch.agent;
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

  const handleDragEnd = useCallback(async (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }
    const nextStatus = destination.droppableId as TaskStatus;

    setTasks((prev) =>
      prev.map((t) => (t.id === draggableId ? { ...t, status: nextStatus } : t)),
    );

    try {
      const updated = await window.electronAPI.tasks.update(draggableId, {
        status: nextStatus,
      });
      const pending = pendingRef.current.get(draggableId);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === draggableId ? { ...updated, ...(pending?.patch ?? {}) } : t,
        ),
      );
    } catch (err) {
      console.error('[tasks.update] drag-end failed', err);
    }
  }, []);

  const handleCreateTask = useCallback(async (title: string, agent: Agent) => {
    try {
      const task = await window.electronAPI.tasks.create({ title, agent });
      setTasks((prev) => [...prev, task]);
    } catch (err) {
      console.error('[tasks.create] failed', err);
    }
  }, []);

  const handleDeleteTask = useCallback(async (id: string) => {
    const pending = pendingRef.current.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRef.current.delete(id);
    }
    try {
      await window.electronAPI.tasks.delete(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setSelectedTaskId((sid) => (sid === id ? null : sid));
    } catch (err) {
      console.error('[tasks.delete] failed', err);
    }
  }, []);

  const handleProjectOpened = useCallback(async (p: Project) => {
    setProject(p);
    try {
      const all = await window.electronAPI.tasks.getAll();
      setTasks(all);
    } catch (err) {
      console.error('[tasks.getAll] after open failed', err);
      setTasks([]);
    }
  }, []);

  const handleClearProject = useCallback(async () => {
    await window.electronAPI.project.clear();
    setProject(null);
    setTasks([]);
    setSelectedTaskId(null);
  }, []);

  const inProgressCount = tasks.filter((t) => t.status === 'in-progress').length;
  const needsInputCount = tasks.filter((t) => t.status === 'needs-input').length;
  const statusLine = `${inProgressCount} in progress · ${needsInputCount} needs input`;

  const topBarTitle = workspaceView === 'board' ? 'Board' : 'Plan';

  if (projectLoading) {
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
          <WelcomeScreen onProjectOpened={(p) => void handleProjectOpened(p)} />
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
        >
          <TopBar project={project} title={topBarTitle} statusLine={statusLine} />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {workspaceView === 'board' ? (
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <Board
                  tasks={tasks}
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
                />
              </div>
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
    </div>
  );
}
