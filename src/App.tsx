import { useState } from 'react';
import { DropResult } from '@hello-pangea/dnd';
import { Task, TaskStatus, Agent } from './types';
import { SEED_TASKS } from './seed';
import Board from './components/Board';

export default function App() {
  const isMac = window.electronAPI.platform === 'darwin';
  const [tasks, setTasks] = useState<Task[]>(SEED_TASKS);

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

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-950 text-white">
      {isMac ? (
        <div
          className="app-window-drag h-10 w-full shrink-0 bg-gray-950"
          aria-hidden
        />
      ) : null}
      <div className="app-window-no-drag flex flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between px-4 pb-2">
          <h1 className="text-lg font-semibold tracking-tight">Flux</h1>
          <span className="text-xs text-gray-500">AI agent task manager</span>
        </header>
        <div className="flex-1 overflow-hidden">
          <Board
            tasks={tasks}
            onDragEnd={handleDragEnd}
            onCreateTask={handleCreateTask}
            onDeleteTask={handleDeleteTask}
          />
        </div>
      </div>
    </div>
  );
}
