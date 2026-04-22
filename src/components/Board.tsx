import { useState } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { Task, TaskStatus, COLUMNS, Agent } from '../types';
import Column from './Column';
import NewTaskModal from './NewTaskModal';

interface Props {
  tasks: Task[];
  onDragEnd: (result: DropResult) => void;
  onCreateTask: (title: string, agent: Agent) => void;
  onDeleteTask: (id: string) => void;
  onCardClick: (id: string) => void;
  planPanelOpen: boolean;
  onTogglePlanPanel: () => void;
}

export default function Board({
  tasks,
  onDragEnd,
  onCreateTask,
  onDeleteTask,
  onCardClick,
  planPanelOpen,
  onTogglePlanPanel,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);

  const tasksByStatus: Record<TaskStatus, Task[]> = {
    backlog: [],
    'in-progress': [],
    'needs-input': [],
    done: [],
  };
  for (const task of tasks) {
    tasksByStatus[task.status].push(task);
  }

  const boardIsEmpty = tasks.length === 0;

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-gray-800 px-4 py-2">
          <button
            type="button"
            onClick={onTogglePlanPanel}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
              planPanelOpen
                ? 'border-gray-700 bg-gray-800 text-gray-200'
                : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'
            }`}
          >
            Plan
          </button>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-600 hover:text-gray-300"
          >
            + New task
          </button>
        </div>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden p-4">
        {COLUMNS.map((col) => (
          <Column
            key={col.id}
            id={col.id}
            label={col.label}
            tasks={tasksByStatus[col.id]}
            onNewTask={col.id === 'backlog' ? () => setModalOpen(true) : undefined}
            onDeleteTask={onDeleteTask}
            onCardClick={onCardClick}
            emptyState={
              col.id === 'backlog' && boardIsEmpty
                ? 'No tasks yet. Create one to get started.'
                : undefined
            }
          />
        ))}
        </div>
      </div>
      {modalOpen ? (
        <NewTaskModal
          onClose={() => setModalOpen(false)}
          onCreate={(title, agent) => {
            onCreateTask(title, agent);
            setModalOpen(false);
          }}
        />
      ) : null}
    </DragDropContext>
  );
}
