import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { GitBranchPresence, RepoBranchDiscovery } from '../types';
import {
  classifyGitBranchPresence,
  gitBranchShortNameLooksValid,
  mergeDiscoveryBranchSuggestions,
  normalizeGitBranchShortName,
} from '../taskBranches';

export type TaskSourceBranchPickerVariant = 'modal' | 'panel';

interface Props {
  variant?: TaskSourceBranchPickerVariant;
  idPrefix: string;
  /** Current text in the branch field (short name, user-visible). */
  branchInput: string;
  onBranchInputChange: (next: string) => void;
  discovery: RepoBranchDiscovery | null;
  discoveryLoading: boolean;
  discoveryError: string | null;
  /** When false, the field is read-only (locked after worktree / session). */
  editable?: boolean;
  disabled?: boolean;
  /** Fired from the text field `onBlur` (after suggestion list handling). */
  onInputBlur?: () => void;
}

function presenceLabel(p: GitBranchPresence): string {
  switch (p) {
    case 'local':
      return 'On this machine (local branch)';
    case 'remote':
      return 'On remote (fetch may be needed locally)';
    case 'both':
      return 'Available locally';
    case 'missing':
      return 'Not in this clone yet';
    default:
      return '';
  }
}

export function describePendingBranchCreation(
  branchShort: string,
  defaultBranchShort: string,
): string {
  const b = normalizeGitBranchShortName(branchShort);
  const d = normalizeGitBranchShortName(defaultBranchShort);
  return `Flux will create branch ${b} from ${d} when this task starts.`;
}

export default function TaskSourceBranchPicker({
  variant = 'modal',
  idPrefix,
  branchInput,
  onBranchInputChange,
  discovery,
  discoveryLoading,
  discoveryError,
  editable = true,
  disabled = false,
  onInputBlur,
}: Props) {
  const reactId = useId();
  const listboxId = `${idPrefix}-${reactId}-branches`;
  const [listOpen, setListOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setListOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [listOpen]);

  const suggestions = useMemo(
    () => (discovery ? mergeDiscoveryBranchSuggestions(discovery) : []),
    [discovery],
  );

  const emptyRepo =
    discovery != null &&
    discovery.localBranches.length === 0 &&
    discovery.remoteBranches.length === 0;

  const normalizedInput = normalizeGitBranchShortName(branchInput);
  const presence: GitBranchPresence | null =
    discovery && normalizedInput
      ? classifyGitBranchPresence(
          branchInput,
          discovery.localBranches,
          discovery.remoteBranches,
        ).presence
      : null;

  const invalidName =
    normalizedInput.length > 0 && !gitBranchShortNameLooksValid(branchInput);

  const inputClass =
    'w-full rounded-md border bg-flux-surface px-3 py-2 text-[13px] text-flux-fg placeholder:text-flux-fg-subtle outline-none transition focus:ring-1';

  const borderTone = invalidName
    ? 'border-red-500/35 focus:border-red-400/45 focus:ring-red-400/25'
    : 'border-flux-border/12 focus:border-flux-border/20 focus:ring-flux-ring/20';

  return (
    <div className="space-y-1.5" data-task-source-branch-picker={variant}>
      <label
        htmlFor={`${idPrefix}-branch-input`}
        className="block text-[11px] font-medium uppercase tracking-[0.12em] text-flux-fg-subtle"
      >
        Source branch
      </label>

      {discoveryLoading ? (
        <p className="text-[12px] text-flux-fg-subtle" role="status">
          Loading branches…
        </p>
      ) : null}

      {discoveryError && !discoveryLoading ? (
        <p className="text-[12px] leading-snug text-amber-200/90" role="alert">
          Could not read git branches on this machine: {discoveryError}. Branch metadata is still
          saved; session start may fail until the repo path is valid.
        </p>
      ) : null}

      {discovery && emptyRepo && !discoveryLoading ? (
        <p className="text-[12px] text-flux-fg-subtle" role="status">
          No local or <code className="text-flux-fg-muted">origin/*</code> branches were found. You can
          still type a branch name; Flux can create it from {discovery.defaultBranchShort} when the
          task starts.
        </p>
      ) : null}

      <div className="relative" ref={wrapRef}>
        <input
          id={`${idPrefix}-branch-input`}
          type="text"
          value={branchInput}
          disabled={disabled || !editable || discoveryLoading}
          onChange={(e) => onBranchInputChange(e.target.value)}
          onFocus={() => setListOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setListOpen(false), 120);
            onInputBlur?.();
          }}
          autoComplete="off"
          spellCheck={false}
          placeholder={discovery?.defaultBranchShort ?? 'main'}
          aria-invalid={invalidName}
          aria-describedby={`${idPrefix}-branch-help`}
          className={`${inputClass} ${borderTone} disabled:cursor-not-allowed disabled:opacity-60`}
        />
        {editable && suggestions.length > 0 ? (
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled || discoveryLoading}
            onMouseDown={(e) => {
              e.preventDefault();
              setListOpen((o) => !o);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-flux-fg-subtle hover:bg-flux-hover/8 hover:text-flux-fg-muted disabled:opacity-40"
            aria-label="Show branch suggestions"
          >
            <ChevronDown className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        ) : null}

        {listOpen && editable && suggestions.length > 0 ? (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-flux-border/12 bg-flux-elevated py-1 shadow-xl shadow-black/25"
          >
            {suggestions.map((name) => (
              <li key={name} role="presentation">
                <button
                  type="button"
                  role="option"
                  className="flex w-full px-3 py-2 text-left text-[13px] text-flux-fg-muted hover:bg-flux-hover/8"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onBranchInputChange(name);
                    setListOpen(false);
                  }}
                >
                  {name}
                  {discovery && name === discovery.defaultBranchShort ? (
                    <span className="ml-auto pl-2 text-[11px] text-flux-fg-subtle">default</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div id={`${idPrefix}-branch-help`} className="space-y-1">
        {invalidName ? (
          <p className="text-[11px] leading-snug text-red-300/90" role="alert">
            That branch name uses characters git does not allow in a branch name.
          </p>
        ) : null}
        {!invalidName && discovery && normalizedInput ? (
          <>
            {presence === 'missing' ? (
              <p className="text-[11px] leading-snug text-sky-200/85">
                {describePendingBranchCreation(normalizedInput, discovery.defaultBranchShort)}
              </p>
            ) : presence ? (
              <p className="text-[11px] text-flux-fg-subtle">{presenceLabel(presence)}</p>
            ) : null}
          </>
        ) : null}
        {!invalidName && discovery && !normalizedInput ? (
          <p className="text-[11px] text-flux-fg-subtle">
            Uses project default ({discovery.defaultBranchShort}) when left blank.
          </p>
        ) : null}
      </div>
    </div>
  );
}
