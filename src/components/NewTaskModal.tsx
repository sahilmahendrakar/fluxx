import { useEffect, useRef, useState } from 'react';
import { Agent, AGENTS } from '../types';

interface Props {
  onClose: () => void;
  onCreate: (title: string, agent: Agent) => void;
}

export default function NewTaskModal({ onClose, onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [agent, setAgent] = useState<Agent>('claude-code');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmed = title.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onCreate(trimmed, agent);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-gray-900 p-5 shadow-xl ring-1 ring-white/5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-100">New task</h2>

        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-gray-400">
          Title
        </label>
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="What needs to get done?"
          className="mt-1 w-full rounded-md bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />

        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-gray-400">
          Agent
        </label>
        <div className="mt-2 flex gap-2">
          {AGENTS.map((a) => {
            const active = a.id === agent;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAgent(a.id)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {a.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
          >
            Create task
          </button>
        </div>
      </div>
    </div>
  );
}
