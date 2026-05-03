import { useEffect, useRef, useState } from 'react';
import { UserCircle2 } from 'lucide-react';
import { Agent, AGENTS, type RepoBranchDiscovery } from '../types';
import { buildCreateTaskBranchPayload, gitBranchShortNameLooksValid } from '../taskBranches';
import { TaskLabelsField } from './TaskLabelsField';
import type { ProjectMember } from '../renderer/projects/members';
import { ProjectMemberAvatar } from './ProjectMemberAvatar';
import TaskSourceBranchPicker from './TaskSourceBranchPicker';

interface Props {
  onClose: () => void;
  onCreate: (
    title: string,
    agent: Agent,
    labels: string[],
    assigneeId?: string,
    branch?: { sourceBranch?: string; createSourceBranchIfMissing?: boolean },
  ) => void;
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
  const [branchDiscovery, setBranchDiscovery] = useState<RepoBranchDiscovery | null>(null);
  const [branchDiscoveryLoading, setBranchDiscoveryLoading] = useState(true);
  const [branchDiscoveryError, setBranchDiscoveryError] = useState<string | null>(null);
  const [branchInput, setBranchInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBranchDiscoveryLoading(true);
    setBranchDiscoveryError(null);
    void window.electronAPI.repo.getBranchDiscovery().then((r) => {
      if (cancelled) return;
      setBranchDiscoveryLoading(false);
      if ('error' in r) {
        setBranchDiscovery(null);
        setBranchDiscoveryError(r.error);
        setBranchInput('');
        return;
      }
      setBranchDiscovery(r);
      setBranchInput(r.defaultBranchShort);
    });
    return () => {
      cancelled = true;
    };
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
  const branchTrim = branchInput.trim();
  const branchNameOk = branchTrim === '' || gitBranchShortNameLooksValid(branchInput);
  const canSubmit = trimmed.length > 0 && branchNameOk;

  const submit = () => {
    if (!canSubmit) return;
    const branch = buildCreateTaskBranchPayload(branchInput, branchDiscovery);
    onCreate(trimmed, agent, labels, assigneeId, branch);
  };

  /** Defined only for cloud projects (may be empty while members load). */
  const showAssigneePicker = projectMembers !== undefined;
  const selectedMember = assigneeId
    ? projectMembers?.find((m) => m.uid === assigneeId)
    : undefined;

  function memberLabel(m: ProjectMember): string {
    return m.displayName || m.email || m.uid;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[400px] rounded-lg border border-flux-border/12 bg-flux-elevated p-5 shadow-2xl shadow-black/25"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-medium tracking-tight text-flux-fg">New task</h2>
        <p className="mt-1 text-[13px] text-flux-fg-subtle">Add a task to the backlog.</p>

        <label className="mt-5 block text-[11px] font-medium uppercase tracking-[0.12em] text-flux-fg-subtle">
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
          className="mt-1.5 w-full rounded-md border border-flux-border/12 bg-flux-surface px-3 py-2 text-[13px] text-flux-fg placeholder:text-flux-fg-subtle outline-none transition focus:border-flux-border/20 focus:ring-1 focus:ring-flux-ring/20"
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

        <div className="mt-4">
          <TaskSourceBranchPicker
            idPrefix="new-task"
            branchInput={branchInput}
            onBranchInputChange={setBranchInput}
            discovery={branchDiscovery}
            discoveryLoading={branchDiscoveryLoading}
            discoveryError={branchDiscoveryError}
          />
        </div>

        <label className="mt-4 block text-[11px] font-medium uppercase tracking-[0.12em] text-flux-fg-subtle">
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
                    ? 'border-flux-border/18 bg-flux-selected/12 text-flux-fg shadow-[inset_0_0_0_1px_rgb(var(--flux-border)/0.08)]'
                    : 'border-transparent bg-flux-hover/4 text-flux-fg-subtle hover:border-flux-border/12 hover:bg-flux-hover/8 hover:text-flux-fg-muted'
                }`}
              >
                {a.label}
              </button>
            );
          })}
        </div>

        {showAssigneePicker && (
          <>
            <label className="mt-4 block text-[11px] font-medium uppercase tracking-[0.12em] text-flux-fg-subtle">
              Assignee
            </label>
            <div className="relative mt-2" ref={assigneeDropdownRef}>
              <button
                type="button"
                onClick={() => setAssigneeDropdownOpen((v) => !v)}
                className="flex w-full items-center gap-2 rounded-md border border-flux-border/12 bg-flux-surface px-3 py-2 text-[13px] transition hover:border-flux-border/18"
              >
                {selectedMember ? (
                  <>
                    <ProjectMemberAvatar member={selectedMember} size="xs" />
                    <span className="text-flux-fg">{memberLabel(selectedMember)}</span>
                  </>
                ) : (
                  <>
                    <UserCircle2
                      className="h-5 w-5 shrink-0 text-flux-fg-subtle"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <span className="text-flux-fg-subtle">Unassigned</span>
                  </>
                )}
                <svg
                  className="ml-auto h-3.5 w-3.5 shrink-0 text-flux-fg-subtle"
                  fill="none"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6l4 4 4-4" />
                </svg>
              </button>
              {assigneeDropdownOpen && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-flux-border/12 bg-flux-elevated py-1 shadow-xl shadow-black/25">
                  <button
                    type="button"
                    onClick={() => {
                      setAssigneeId(undefined);
                      setAssigneeDropdownOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-[13px] transition hover:bg-flux-hover/6 ${
                      !assigneeId ? 'text-flux-fg-muted' : 'text-flux-fg-subtle'
                    }`}
                  >
                    <UserCircle2 className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden />
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
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-[13px] transition hover:bg-flux-hover/6 ${
                        assigneeId === m.uid ? 'text-flux-fg' : 'text-flux-fg-muted'
                      }`}
                    >
                      <ProjectMemberAvatar member={m} size="xs" />
                      {memberLabel(m)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div className="mt-6 flex justify-end gap-2 border-t border-flux-border/10 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] text-flux-fg-subtle transition hover:bg-flux-hover/6 hover:text-flux-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md border border-flux-border/15 bg-flux-fg px-3 py-1.5 text-[13px] font-medium text-flux-canvas shadow-sm transition hover:bg-flux-fg/90 disabled:pointer-events-none disabled:border-transparent disabled:bg-flux-hover/15 disabled:text-flux-fg-subtle"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
