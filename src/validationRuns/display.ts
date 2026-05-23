import type { Task, Session } from '../types';
import type { ValidationPackId } from '../validationPacks/types';
import type { ValidationRun, ValidationRunStatus } from './types';

/** Compact board-card validation states (subset of run statuses + not-run). */
export type ValidationBoardBadgeStatus =
  | 'not-run'
  | 'running'
  | 'passed'
  | 'failed'
  | 'review-needed'
  | 'errored';

const PACK_LABELS: Record<ValidationPackId, string> = {
  'electron-playwright': 'Electron Playwright',
};

export function validationPackDisplayName(packId: ValidationPackId): string {
  return PACK_LABELS[packId] ?? packId;
}

export function pickLatestValidationRun(runs: ValidationRun[]): ValidationRun | null {
  if (runs.length === 0) return null;
  return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
}

export function validationRunStatusToBoardBadge(
  status: ValidationRunStatus | null | undefined,
): ValidationBoardBadgeStatus {
  if (!status) return 'not-run';
  switch (status) {
    case 'queued':
    case 'running':
      return 'running';
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'needs-human-review':
      return 'review-needed';
    case 'errored':
      return 'errored';
    case 'cancelled':
      return 'not-run';
    default:
      return 'not-run';
  }
}

export function validationBoardBadgeFromRuns(runs: ValidationRun[]): ValidationBoardBadgeStatus {
  const latest = pickLatestValidationRun(runs);
  return validationRunStatusToBoardBadge(latest?.status);
}

export function validationBoardBadgeLabel(status: ValidationBoardBadgeStatus): string {
  switch (status) {
    case 'not-run':
      return 'Validation: not run';
    case 'running':
      return 'Validation: running';
    case 'passed':
      return 'Validation: passed';
    case 'failed':
      return 'Validation: failed';
    case 'review-needed':
      return 'Validation: review needed';
    case 'errored':
      return 'Validation: errored';
    default:
      return 'Validation';
  }
}

export function validationBoardBadgeShortLabel(status: ValidationBoardBadgeStatus): string {
  switch (status) {
    case 'not-run':
      return 'Not run';
    case 'running':
      return 'Running';
    case 'passed':
      return 'Passed';
    case 'failed':
      return 'Failed';
    case 'review-needed':
      return 'Review';
    case 'errored':
      return 'Errored';
    default:
      return 'Validation';
  }
}

export function validationBoardBadgeClass(status: ValidationBoardBadgeStatus): string {
  switch (status) {
    case 'not-run':
      return 'border-white/[0.08] bg-white/[0.03] text-zinc-500';
    case 'running':
      return 'border-sky-500/30 bg-sky-500/[0.1] text-sky-200/95';
    case 'passed':
      return 'border-emerald-500/30 bg-emerald-500/[0.1] text-emerald-200/95';
    case 'failed':
      return 'border-red-500/30 bg-red-500/[0.1] text-red-200/95';
    case 'review-needed':
      return 'border-amber-500/30 bg-amber-500/[0.1] text-amber-200/95';
    case 'errored':
      return 'border-orange-500/30 bg-orange-500/[0.1] text-orange-200/95';
    default:
      return 'border-white/[0.08] bg-white/[0.03] text-zinc-500';
  }
}

export function validationRunStatusLabel(status: ValidationRunStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'passed':
      return 'Passed';
    case 'failed':
      return 'Failed';
    case 'needs-human-review':
      return 'Needs human review';
    case 'errored':
      return 'Errored';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

export function validationRunStatusDetailClass(status: ValidationRunStatus): string {
  switch (status) {
    case 'queued':
    case 'running':
      return 'text-sky-200/95';
    case 'passed':
      return 'text-emerald-200/95';
    case 'failed':
      return 'text-red-200/95';
    case 'needs-human-review':
      return 'text-amber-200/95';
    case 'errored':
      return 'text-orange-200/95';
    case 'cancelled':
      return 'text-zinc-500';
    default:
      return 'text-zinc-300';
  }
}

export function formatValidationTimestamp(iso: string | undefined): string {
  if (!iso?.trim()) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function validationRunIsActive(status: ValidationRunStatus | undefined): boolean {
  return status === 'queued' || status === 'running';
}

/** Task workspace shows a Validation tab while a run is in flight or its PTY is live. */
export function taskWorkspaceShouldShowValidationTab(input: {
  latestRun: ValidationRun | null;
  validatorSession: Pick<Session, 'status'> | null;
}): boolean {
  if (validationRunIsActive(input.latestRun?.status)) return true;
  return input.validatorSession?.status === 'running';
}

export function taskCardShouldShowValidationBadge(
  taskStatus: Task['status'],
  runs: ValidationRun[],
): boolean {
  if (taskStatus === 'review') return true;
  return runs.length > 0;
}

export type ManualValidationBlockReason =
  | 'not-review'
  | 'no-agent'
  | 'already-running'
  | 'repo-blocked';

export type ManualValidationEligibility = {
  canRun: boolean;
  reason?: ManualValidationBlockReason;
  message?: string;
};

export function evaluateManualValidationEligibility(input: {
  task: Pick<Task, 'status' | 'agent'>;
  latestRun: ValidationRun | null;
  repoBlocked?: boolean;
}): ManualValidationEligibility {
  if (input.repoBlocked) {
    return {
      canRun: false,
      reason: 'repo-blocked',
      message: 'Fix repository setup before running validation.',
    };
  }
  if (input.task.status !== 'review') {
    return {
      canRun: false,
      reason: 'not-review',
      message: 'Move this task to Review before running validation.',
    };
  }
  if (input.task.agent == null) {
    return {
      canRun: false,
      reason: 'no-agent',
      message: 'Choose an agent for this task before running validation.',
    };
  }
  if (validationRunIsActive(input.latestRun?.status)) {
    return {
      canRun: false,
      reason: 'already-running',
      message: 'Validation is already running for this task.',
    };
  }
  return { canRun: true };
}
