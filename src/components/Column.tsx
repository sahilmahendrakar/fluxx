import { Droppable } from '@hello-pangea/dnd';
import { Task, TaskStatus } from '../types';
import TaskCard from './TaskCard';

interface Props {
  id: TaskStatus;
  label: string;
  tasks: Task[];
  onNewTask?: () => void;
  onDeleteTask: (id: string) => void;
}

export default function Column({ id, label, tasks, onNewTask, onDeleteTask }: Props) {
  const isNeedsInput = id === 'needs-input';

  return (
    <div className="flex min-w-[260px] flex-1 flex-col rounded-lg bg-gray-900">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h2
            className={`text-sm font-semibold uppercase tracking-wide ${
              isNeedsInput ? 'text-amber-400' : 'text-gray-300'
            }`}
          >
            {label}
          </h2>
          <span
            className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
              isNeedsInput
                ? 'bg-amber-900/60 text-amber-300'
                : 'bg-gray-800 text-gray-400'
            }`}
          >
            {tasks.length}
          </span>
        </div>
        {onNewTask ? (
          <button
            type="button"
            onClick={onNewTask}
            className="rounded px-2 py-0.5 text-xs font-medium text-gray-400 transition hover:bg-gray-800 hover:text-gray-100"
          >
            + New task
          </button>
        ) : null}
      </div>
      <Droppable droppableId={id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition ${
              snapshot.isDraggingOver ? 'bg-gray-800/50' : ''
            }`}
          >
            {tasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                onDelete={onDeleteTask}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
