import { useEffect, useRef, useState } from 'react';
import { Agent, AGENTS } from '../types';
import { TaskLabelsField } from './TaskLabelsField';
import type { ProjectMember } from '../renderer/projects/members';

interface Props {
  onClose: () => void;
  onCreate: (title: string, agent: Agent, labels: string[], assigneeId?: string) => void;
  /** Union of labels on existing tasks, for the picker. */
  labelCatalog: string[];
  /** Default agent for this project (local `config.json` or cloud binding prefs). */
  defaultAgent?: Agent;
  /** Cloud-only: team members available for assignment. */
  projectMembers?: ProjectMember[];
}

export default function NewTaskModal({
  onClose,
  onCreate,
  labelCatalog,
  defaultAgent = 'claude-code',
  projectMembers,
}: Props) {
  const [title, setTitle] = useState('');
  const [agent, setAgent] = useState<Agent>(defaultAgent);
  const [labels, setLabels] = useState<string[]>([]);
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined);
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!assigneeDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (!assigneeDropdownRef.current?.contains(e.target as Node)) {
        setAssigneeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [assigneeDropdownOpen]);

  const trimmed = title.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onCreate(trimmed, agent, labels, assigneeId);
  };

  /** Defined only for cloud projects (may be empty while members load). */
  const showAssigneePicker = projectMembers !== undefined;
  const selectedMember = assigneeId
    ? projectMembers?.find((m) => m.uid === assigneeId)
    : undefined;

  function memberInitial(m: ProjectMember): string {
    return (m.displayName || m.email || '?').slice(0, 1).toUpperCase();
  }

  function memberLabel(m: ProjectMember): string {
    return m.displayName || m.email || m.uid;
  }

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

        {showAssigneePicker && (
          <>
            <label className="mt-4 block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600">
              Assignee
            </label>
            <div className="relative mt-2" ref={assigneeDropdownRef}>
              <button
                type="button"
                onClick={() => setAssigneeDropdownOpen((v) => !v)}
                className="flex w-full items-center gap-2 rounded-md border border-white/[0.08] bg-[#09090b] px-3 py-2 text-[13px] transition hover:border-white/[0.14]"
              >
                {selectedMember ? (
                  <>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/[0.12] text-[10px] font-medium text-sky-300">
                      {memberInitial(selectedMember)}
                    </span>
                    <span className="text-zinc-100">{memberLabel(selectedMember)}</span>
                  </>
                ) : (
                  <span className="text-zinc-500">Unassigned</span>
                )}
                <svg
                  className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-600"
                  fill="none"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6l4 4 4-4" />
                </svg>
              </button>
              {assigneeDropdownOpen && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-white/[0.08] bg-[#101012] py-1 shadow-xl shadow-black/40">
                  <button
                    type="button"
                    onClick={() => {
                      setAssigneeId(undefined);
                      setAssigneeDropdownOpen(false);
                    }}
                    className={`flex w-full items-center px-3 py-1.5 text-[13px] transition hover:bg-white/[0.04] ${
                      !assigneeId ? 'text-zinc-300' : 'text-zinc-500'
                    }`}
                  >
                    Unassigned
                  </button>
                  {(projectMembers ?? []).map((m) => (
                    <button
                      key={m.uid}
                      type="button"
                      onClick={() => {
                        setAssigneeId(m.uid);
                        setAssigneeDropdownOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-[13px] transition hover:bg-white/[0.04] ${
                        assigneeId === m.uid ? 'text-zinc-100' : 'text-zinc-400'
                      }`}
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/[0.12] text-[10px] font-medium text-sky-300">
                        {memberInitial(m)}
                      </span>
                      {memberLabel(m)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

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
