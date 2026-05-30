import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { GitBranchPresence, RepoBranchDiscovery } from '../types';
import {
  classifyGitBranchPresence,
  gitBranchShortNameLooksValid,
  mergeDiscoveryBranchSuggestions,
  normalizeGitBranchShortName,
} from '../taskBranches';
import { shouldShowTaskSourceBranchPicker } from '../gitUiGating';

export type TaskSourceBranchPickerVariant = 'modal' | 'panel';

interface Props {
  /** When false, renders nothing (gitless project). Defaults to on. */
  gitEnabled?: boolean;
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
  /**
   * Reserved for multi-repo2: human-readable repo name when branch discovery is scoped
   * (forward-compatible; optional copy wiring uses this later).
   */
  repoScopeLabel?: string;
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
  return `Fluxx will create branch ${b} from ${d} when this task starts.`;
}

export default function TaskSourceBranchPicker({
  gitEnabled = true,
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
  repoScopeLabel,
}: Props) {
  if (!shouldShowTaskSourceBranchPicker(gitEnabled)) return null;

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

  const muted = variant === 'panel';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <Label
          htmlFor={`${idPrefix}-branch-input`}
          className={cn(
            'text-[11px] font-medium uppercase tracking-[0.12em]',
            muted ? 'text-muted-foreground' : 'text-muted-foreground/80',
          )}
        >
          Source branch
        </Label>
        {repoScopeLabel ? (
          <span className="text-[11px] text-muted-foreground" title="Branch list scope">
            {repoScopeLabel}
          </span>
        ) : null}
      </div>

      {discoveryLoading ? (
        <p className="text-xs text-muted-foreground" role="status">
          Loading branches…
        </p>
      ) : null}

      {discoveryError && !discoveryLoading ? (
        <p
          className="text-xs leading-snug text-status-needs-input-foreground"
          role="alert"
        >
          Could not read git branches on this machine: {discoveryError}. Branch metadata is still
          saved; session start may fail until the repo path is valid.
        </p>
      ) : null}

      {discovery && emptyRepo && !discoveryLoading ? (
        <p className="text-xs text-muted-foreground" role="status">
          No local or <code className="text-foreground/80">origin/*</code> branches were found. You
          can still type a branch name; Fluxx can create it from {discovery.defaultBranchShort}{' '}
          when the task starts.
        </p>
      ) : null}

      <div className="relative" ref={wrapRef}>
        <Input
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
          className={cn(
            'h-9 text-[13px]',
            invalidName && 'border-destructive focus-visible:ring-destructive',
          )}
        />
        {editable && suggestions.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tabIndex={-1}
            disabled={disabled || discoveryLoading}
            onMouseDown={(e) => {
              e.preventDefault();
              setListOpen((o) => !o);
            }}
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
            aria-label="Show branch suggestions"
          >
            <ChevronDown strokeWidth={2} aria-hidden />
          </Button>
        ) : null}

        {listOpen && editable && suggestions.length > 0 ? (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md"
          >
            {suggestions.map((name) => (
              <li key={name} role="presentation">
                <button
                  type="button"
                  role="option"
                  className="flex w-full px-3 py-2 text-left text-[13px] text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onBranchInputChange(name);
                    setListOpen(false);
                  }}
                >
                  {name}
                  {discovery && name === discovery.defaultBranchShort ? (
                    <span className="ml-auto pl-2 text-[11px] text-muted-foreground">default</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div id={`${idPrefix}-branch-help`} className="flex flex-col gap-1">
        {invalidName ? (
          <p className="text-[11px] leading-snug text-destructive" role="alert">
            That branch name uses characters git does not allow in a branch name.
          </p>
        ) : null}
        {!invalidName && discovery && normalizedInput ? (
          <>
            {presence === 'missing' ? (
              <p className="text-[11px] leading-snug text-status-review-foreground">
                {describePendingBranchCreation(normalizedInput, discovery.defaultBranchShort)}
              </p>
            ) : presence ? (
              <p className="text-[11px] text-muted-foreground">{presenceLabel(presence)}</p>
            ) : null}
          </>
        ) : null}
        {!invalidName && discovery && !normalizedInput ? (
          <p className="text-[11px] text-muted-foreground">
            Uses project default ({discovery.defaultBranchShort}) when left blank.
          </p>
        ) : null}
      </div>
    </div>
  );
}
