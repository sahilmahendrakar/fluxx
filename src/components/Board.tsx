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
}

export default function Board({ tasks, onDragEnd, onCreateTask, onDeleteTask }: Props) {
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

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex h-full w-full gap-3 overflow-x-auto p-3">
        {COLUMNS.map((col) => (
          <Column
            key={col.id}
            id={col.id}
            label={col.label}
            tasks={tasksByStatus[col.id]}
            onNewTask={col.id === 'backlog' ? () => setModalOpen(true) : undefined}
            onDeleteTask={onDeleteTask}
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
