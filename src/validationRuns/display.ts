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

export function sortValidationRunsNewestFirst(runs: ValidationRun[]): ValidationRun[] {
  return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function pickLatestValidationRun(runs: ValidationRun[]): ValidationRun | null {
  if (runs.length === 0) return null;
  return sortValidationRunsNewestFirst(runs)[0] ?? null;
}

export function pickValidationRunById(
  runs: ValidationRun[],
  runId: string | null | undefined,
): ValidationRun | null {
  const trimmed = runId?.trim();
  if (!trimmed) return null;
  return runs.find((run) => run.id === trimmed) ?? null;
}

export function validationRunShortId(runId: string): string {
  const trimmed = runId.trim();
  if (trimmed.length <= 8) return trimmed;
  return trimmed.slice(-8);
}

export function validationRunPickerLabel(run: ValidationRun): string {
  const shortId = validationRunShortId(run.id);
  const status = validationRunStatusLabel(run.status);
  const started = formatValidationTimestamp(run.startedAt);
  const completed = run.completedAt ? formatValidationTimestamp(run.completedAt) : null;
  if (completed && completed !== '—') {
    return `${shortId} · ${status} · ${started} → ${completed}`;
  }
  return `${shortId} · ${status} · ${started}`;
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
      return 'border-border bg-muted/50 text-muted-foreground';
    case 'running':
      return 'border-status-review/30 bg-status-review/15 text-status-review-foreground';
    case 'passed':
      return 'border-status-success/30 bg-status-success/15 text-status-success-foreground';
    case 'failed':
      return 'border-destructive/30 bg-destructive/15 text-destructive-foreground';
    case 'review-needed':
      return 'border-status-needs-input/30 bg-status-needs-input/15 text-status-needs-input-foreground';
    case 'errored':
      return 'border-status-needs-input/35 bg-status-needs-input/12 text-status-needs-input-foreground';
    default:
      return 'border-border bg-muted/50 text-muted-foreground';
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
      return 'text-status-review';
    case 'passed':
      return 'text-status-success';
    case 'failed':
      return 'text-destructive';
    case 'needs-human-review':
      return 'text-status-needs-input';
    case 'errored':
      return 'text-status-needs-input';
    case 'cancelled':
      return 'text-muted-foreground';
    default:
      return 'text-foreground';
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
  if (taskStatus === 'validation') return true;
  return runs.length > 0;
}

export type ManualValidationBlockReason =
  | 'not-validation'
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
  if (input.task.status !== 'validation') {
    return {
      canRun: false,
      reason: 'not-validation',
      message: 'Move this task to Validation before running validation.',
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
