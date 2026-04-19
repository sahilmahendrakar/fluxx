import { useState } from 'react';
import { DropResult } from '@hello-pangea/dnd';
import { Task, TaskStatus, Agent } from './types';
import { SEED_TASKS } from './seed';
import Board from './components/Board';
import { AppShell } from './components/AppShell';
import { TopBar } from './components/TopBar';
import type { WorkspaceNavView } from './components/Sidebar';

export default function App() {
  const isMac = window.electronAPI.platform === 'darwin';
  const [tasks, setTasks] = useState<Task[]>(SEED_TASKS);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceNavView>('board');

  const handleDragEnd = (result: DropResult) => {
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
      prev.map((t) => (t.id === draggableId ? { ...t, status: nextStatus } : t))
    );
  };

  const handleCreateTask = (title: string, agent: Agent) => {
    const newTask: Task = {
      id: crypto.randomUUID(),
      title,
      status: 'backlog',
      agent,
      createdAt: new Date().toISOString(),
    };
    setTasks((prev) => [...prev, newTask]);
  };

  const handleDeleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const inProgressCount = tasks.filter((t) => t.status === 'in-progress').length;
  const needsInputCount = tasks.filter((t) => t.status === 'needs-input').length;
  const statusLine = `${inProgressCount} in progress · ${needsInputCount} needs input`;

  const topBarTitle = workspaceView === 'board' ? 'Board' : 'Plan';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-950 text-white">
      {isMac ? (
        <div
          className="app-window-drag h-10 w-full shrink-0 bg-gray-950"
          aria-hidden
        />
      ) : null}
      <div className="app-window-no-drag flex min-h-0 flex-1 flex-col overflow-hidden">
        <AppShell workspaceView={workspaceView} onWorkspaceViewChange={setWorkspaceView}>
          <TopBar title={topBarTitle} statusLine={statusLine} />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {workspaceView === 'board' ? (
              <div className="min-h-0 flex-1 overflow-hidden">
                <Board
                  tasks={tasks}
                  onDragEnd={handleDragEnd}
                  onCreateTask={handleCreateTask}
                  onDeleteTask={handleDeleteTask}
                />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 text-sm text-gray-500">
                Planning assistant coming soon
              </div>
            )}
          </div>
        </AppShell>
      </div>
    </div>
  );
}
