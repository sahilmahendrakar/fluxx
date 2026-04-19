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
}

export default function Board({
  tasks,
  onDragEnd,
  onCreateTask,
  onDeleteTask,
  onCardClick,
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
      <div className="flex h-full w-full gap-3 overflow-x-auto p-4">
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
