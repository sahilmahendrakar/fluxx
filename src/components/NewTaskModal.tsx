import { useEffect, useRef, useState } from 'react';
import { Agent, AGENTS } from '../types';
import { TaskLabelsField } from './TaskLabelsField';

interface Props {
  onClose: () => void;
  onCreate: (title: string, agent: Agent, labels: string[]) => void;
  /** Union of labels on existing tasks, for the picker. */
  labelCatalog: string[];
  /** Default agent for this project (local `config.json` or cloud binding prefs). */
  defaultAgent?: Agent;
}

export default function NewTaskModal({
  onClose,
  onCreate,
  labelCatalog,
  defaultAgent = 'claude-code',
}: Props) {
  const [title, setTitle] = useState('');
  const [agent, setAgent] = useState<Agent>(defaultAgent);
  const [labels, setLabels] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setAgent(defaultAgent);
  }, [defaultAgent]);

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
    onCreate(trimmed, agent, labels);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[400px] rounded-lg border border-white/[0.08] bg-[#101012] p-5 shadow-2xl shadow-black/40"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-medium tracking-tight text-zinc-100">New task</h2>
        <p className="mt-1 text-[13px] text-zinc-500">Add a task to the backlog.</p>

        <label className="mt-5 block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600">
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
          placeholder="What should the agent do?"
          className="mt-1.5 w-full rounded-md border border-white/[0.08] bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-white/[0.14] focus:ring-1 focus:ring-white/[0.12]"
        />

        <div className="mt-4">
          <TaskLabelsField
            idPrefix="new-task"
            labels={labels}
            labelCatalog={labelCatalog}
            onLabelsChange={setLabels}
            compact
          />
        </div>

        <label className="mt-4 block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600">
          Agent
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {AGENTS.map((a) => {
            const active = a.id === agent;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAgent(a.id)}
                className={`rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition ${
                  active
                    ? 'border-white/[0.14] bg-white/[0.08] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
                    : 'border-transparent bg-white/[0.03] text-zinc-500 hover:border-white/[0.08] hover:bg-white/[0.05] hover:text-zinc-300'
                }`}
              >
                {a.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-white/[0.06] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md border border-white/[0.12] bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-950 shadow-sm transition hover:bg-zinc-100 disabled:pointer-events-none disabled:border-transparent disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
