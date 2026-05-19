import type {
  TaskHandoffCheck,
  TaskHandoffCheckStatus,
  TaskHandoffOutcome,
  TaskOverseerDecisionKind,
  TaskOverseerReview,
  TaskWorkerHandoff,
} from './types';

/** Max UTF-8 bytes for a handoff JSON blob submitted via CLI/automation. */
export const MAX_TASK_HANDOFF_JSON_UTF8_BYTES = 32_768;

export const MAX_TASK_HANDOFF_SUMMARY_CHARS = 4_000;
export const MAX_TASK_HANDOFF_FILES_CHANGED = 100;
export const MAX_TASK_HANDOFF_FILE_PATH_CHARS = 512;
export const MAX_TASK_HANDOFF_CHECKS = 50;
export const MAX_TASK_HANDOFF_CHECK_NAME_CHARS = 256;
export const MAX_TASK_HANDOFF_CHECK_DETAIL_CHARS = 2_000;
export const MAX_TASK_HANDOFF_BLOCKERS = 20;
export const MAX_TASK_HANDOFF_STRING_ITEM_CHARS = 2_000;
export const MAX_TASK_HANDOFF_REVIEW_NOTES_CHARS = 4_000;
export const MAX_TASK_OVERSEER_NOTES_CHARS = 4_000;
export const MAX_TASK_OVERSEER_REWORK_INSTRUCTIONS_CHARS = 8_000;

const HANDOFF_OUTCOMES: TaskHandoffOutcome[] = ['complete', 'blocked', 'partial'];
const CHECK_STATUSES: TaskHandoffCheckStatus[] = ['passed', 'failed', 'skipped'];
const OVERSEER_DECISIONS: TaskOverseerDecisionKind[] = ['approved', 'rework'];

export type ParsedTaskWorkerHandoff =
  | { ok: true; handoff: TaskWorkerHandoff }
  | { ok: false; message: string };

export type ParsedTaskOverseerReviewInput =
  | { ok: true; review: TaskOverseerReview }
  | { ok: false; message: string };

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function assertHandoffJsonWithinSizeLimit(rawJson: string): { ok: true } | { ok: false; message: string } {
  const trimmed = rawJson.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: 'Handoff JSON is empty' };
  }
  if (utf8ByteLength(trimmed) > MAX_TASK_HANDOFF_JSON_UTF8_BYTES) {
    return {
      ok: false,
      message: `Handoff JSON exceeds ${MAX_TASK_HANDOFF_JSON_UTF8_BYTES} bytes`,
    };
  }
  return { ok: true };
}

function parseStringArray(
  val: unknown,
  label: string,
  maxItems: number,
  maxItemChars: number,
): { ok: true; items: string[] } | { ok: false; message: string } {
  if (val === undefined) {
    return { ok: true, items: [] };
  }
  if (!Array.isArray(val)) {
    return { ok: false, message: `${label} must be an array of strings` };
  }
  if (val.length > maxItems) {
    return { ok: false, message: `${label} exceeds maximum of ${maxItems} items` };
  }
  const items: string[] = [];
  for (let i = 0; i < val.length; i += 1) {
    const item = val[i];
    if (typeof item !== 'string') {
      return { ok: false, message: `${label}[${i}] must be a string` };
    }
    const t = item.trim();
    if (t.length === 0) {
      return { ok: false, message: `${label}[${i}] must be non-empty` };
    }
    if (t.length > maxItemChars) {
      return {
        ok: false,
        message: `${label}[${i}] exceeds ${maxItemChars} characters`,
      };
    }
    items.push(t);
  }
  return { ok: true, items };
}

function parseChecks(
  val: unknown,
): { ok: true; checks: TaskHandoffCheck[] } | { ok: false; message: string } {
  if (val === undefined) {
    return { ok: true, checks: [] };
  }
  if (!Array.isArray(val)) {
    return { ok: false, message: 'checks must be an array' };
  }
  if (val.length > MAX_TASK_HANDOFF_CHECKS) {
    return { ok: false, message: `checks exceeds maximum of ${MAX_TASK_HANDOFF_CHECKS} items` };
  }
  const checks: TaskHandoffCheck[] = [];
  for (let i = 0; i < val.length; i += 1) {
    const row = val[i];
    if (!row || typeof row !== 'object') {
      return { ok: false, message: `checks[${i}] must be an object` };
    }
    const nameRaw = (row as { name?: unknown }).name;
    const statusRaw = (row as { status?: unknown }).status;
    const detailRaw = (row as { detail?: unknown }).detail;
    if (typeof nameRaw !== 'string' || nameRaw.trim().length === 0) {
      return { ok: false, message: `checks[${i}].name must be a non-empty string` };
    }
    const name = nameRaw.trim();
    if (name.length > MAX_TASK_HANDOFF_CHECK_NAME_CHARS) {
      return {
        ok: false,
        message: `checks[${i}].name exceeds ${MAX_TASK_HANDOFF_CHECK_NAME_CHARS} characters`,
      };
    }
    if (typeof statusRaw !== 'string' || !(CHECK_STATUSES as string[]).includes(statusRaw)) {
      return {
        ok: false,
        message: `checks[${i}].status must be one of: ${CHECK_STATUSES.join(', ')}`,
      };
    }
    const check: TaskHandoffCheck = {
      name,
      status: statusRaw as TaskHandoffCheckStatus,
    };
    if (detailRaw !== undefined) {
      if (typeof detailRaw !== 'string' || detailRaw.trim().length === 0) {
        return { ok: false, message: `checks[${i}].detail must be a non-empty string when set` };
      }
      const detail = detailRaw.trim();
      if (detail.length > MAX_TASK_HANDOFF_CHECK_DETAIL_CHARS) {
        return {
          ok: false,
          message: `checks[${i}].detail exceeds ${MAX_TASK_HANDOFF_CHECK_DETAIL_CHARS} characters`,
        };
      }
      check.detail = detail;
    }
    checks.push(check);
  }
  return { ok: true, checks };
}

/**
 * Strict parse for coordination submit-handoff (CLI, hooks, automation).
 * Sets `submittedAt` to now unless the payload includes a valid ISO timestamp (ignored for hooks;
 * callers should omit it).
 */
export function parseTaskWorkerHandoffForCoordination(
  raw: unknown,
  options?: { submittedAt?: string },
): ParsedTaskWorkerHandoff {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'Handoff must be a JSON object' };
  }
  const o = raw as Record<string, unknown>;
  const outcomeRaw = o.outcome;
  if (typeof outcomeRaw !== 'string' || !(HANDOFF_OUTCOMES as string[]).includes(outcomeRaw)) {
    return {
      ok: false,
      message: `outcome must be one of: ${HANDOFF_OUTCOMES.join(', ')}`,
    };
  }
  const summaryRaw = o.summary;
  if (typeof summaryRaw !== 'string' || summaryRaw.trim().length === 0) {
    return { ok: false, message: 'summary must be a non-empty string' };
  }
  const summary = summaryRaw.trim();
  if (summary.length > MAX_TASK_HANDOFF_SUMMARY_CHARS) {
    return {
      ok: false,
      message: `summary exceeds ${MAX_TASK_HANDOFF_SUMMARY_CHARS} characters`,
    };
  }
  const filesParsed = parseStringArray(
    o.filesChanged,
    'filesChanged',
    MAX_TASK_HANDOFF_FILES_CHANGED,
    MAX_TASK_HANDOFF_FILE_PATH_CHARS,
  );
  if (!filesParsed.ok) return filesParsed;
  const blockersParsed = parseStringArray(
    o.blockers,
    'blockers',
    MAX_TASK_HANDOFF_BLOCKERS,
    MAX_TASK_HANDOFF_STRING_ITEM_CHARS,
  );
  if (!blockersParsed.ok) return blockersParsed;
  const checksParsed = parseChecks(o.checks);
  if (!checksParsed.ok) return checksParsed;
  let reviewNotes: string | undefined;
  if (o.reviewNotes !== undefined) {
    if (typeof o.reviewNotes !== 'string' || o.reviewNotes.trim().length === 0) {
      return { ok: false, message: 'reviewNotes must be a non-empty string when set' };
    }
    const n = o.reviewNotes.trim();
    if (n.length > MAX_TASK_HANDOFF_REVIEW_NOTES_CHARS) {
      return {
        ok: false,
        message: `reviewNotes exceeds ${MAX_TASK_HANDOFF_REVIEW_NOTES_CHARS} characters`,
      };
    }
    reviewNotes = n;
  }
  const submittedAt =
    options?.submittedAt ??
    (typeof o.submittedAt === 'string' && !Number.isNaN(Date.parse(o.submittedAt))
      ? new Date(o.submittedAt).toISOString()
      : new Date().toISOString());
  const handoff: TaskWorkerHandoff = {
    outcome: outcomeRaw as TaskHandoffOutcome,
    summary,
    submittedAt,
  };
  if (filesParsed.items.length > 0) handoff.filesChanged = filesParsed.items;
  if (checksParsed.checks.length > 0) handoff.checks = checksParsed.checks;
  if (blockersParsed.items.length > 0) handoff.blockers = blockersParsed.items;
  if (reviewNotes !== undefined) handoff.reviewNotes = reviewNotes;
  return { ok: true, handoff };
}

export function parseTaskWorkerHandoffFromJsonString(
  rawJson: string,
  options?: { submittedAt?: string },
): ParsedTaskWorkerHandoff {
  const size = assertHandoffJsonWithinSizeLimit(rawJson);
  if (!size.ok) return size;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson.trim()) as unknown;
  } catch {
    return { ok: false, message: 'Handoff JSON is not valid JSON' };
  }
  return parseTaskWorkerHandoffForCoordination(parsed, options);
}

export function parseTaskOverseerReviewInput(input: {
  decision: TaskOverseerDecisionKind;
  reworkInstructions?: string;
  notes?: string;
  reviewedAt?: string;
}): ParsedTaskOverseerReviewInput {
  if (!(OVERSEER_DECISIONS as string[]).includes(input.decision)) {
    return {
      ok: false,
      message: `decision must be one of: ${OVERSEER_DECISIONS.join(', ')}`,
    };
  }
  let reworkInstructions: string | undefined;
  if (input.decision === 'rework') {
    const raw = input.reworkInstructions?.trim() ?? '';
    if (raw.length === 0) {
      return { ok: false, message: 'rework requires non-empty rework instructions' };
    }
    if (raw.length > MAX_TASK_OVERSEER_REWORK_INSTRUCTIONS_CHARS) {
      return {
        ok: false,
        message: `rework instructions exceed ${MAX_TASK_OVERSEER_REWORK_INSTRUCTIONS_CHARS} characters`,
      };
    }
    reworkInstructions = raw;
  } else if (input.reworkInstructions?.trim()) {
    return { ok: false, message: 'rework instructions are only allowed when decision is rework' };
  }
  let notes: string | undefined;
  if (input.notes !== undefined && input.notes.trim().length > 0) {
    const n = input.notes.trim();
    if (n.length > MAX_TASK_OVERSEER_NOTES_CHARS) {
      return {
        ok: false,
        message: `notes exceed ${MAX_TASK_OVERSEER_NOTES_CHARS} characters`,
      };
    }
    notes = n;
  }
  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  const review: TaskOverseerReview = {
    decision: input.decision,
    reviewedAt,
  };
  if (reworkInstructions !== undefined) review.reworkInstructions = reworkInstructions;
  if (notes !== undefined) review.notes = notes;
  return { ok: true, review };
}

/** Firestore / disk read: omit field when invalid or empty. */
export function parsePersistedTaskWorkerHandoff(val: unknown): TaskWorkerHandoff | undefined {
  const parsed = parseTaskWorkerHandoffForCoordination(val, {
    submittedAt:
      val &&
      typeof val === 'object' &&
      typeof (val as { submittedAt?: unknown }).submittedAt === 'string'
        ? (val as { submittedAt: string }).submittedAt
        : undefined,
  });
  return parsed.ok ? parsed.handoff : undefined;
}

export function parsePersistedTaskOverseerReview(val: unknown): TaskOverseerReview | undefined {
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    return undefined;
  }
  const decision = (val as { decision?: unknown }).decision;
  if (typeof decision !== 'string' || !(OVERSEER_DECISIONS as string[]).includes(decision)) {
    return undefined;
  }
  const reviewedAt = (val as { reviewedAt?: unknown }).reviewedAt;
  if (typeof reviewedAt !== 'string' || reviewedAt.trim().length === 0) {
    return undefined;
  }
  const parsed = parseTaskOverseerReviewInput({
    decision: decision as TaskOverseerDecisionKind,
    reworkInstructions:
      typeof (val as { reworkInstructions?: unknown }).reworkInstructions === 'string'
        ? (val as { reworkInstructions: string }).reworkInstructions
        : undefined,
    notes:
      typeof (val as { notes?: unknown }).notes === 'string'
        ? (val as { notes: string }).notes
        : undefined,
    reviewedAt: reviewedAt.trim(),
  });
  return parsed.ok ? parsed.review : undefined;
}

export function workerHandoffToFirestore(handoff: TaskWorkerHandoff): Record<string, unknown> {
  const out: Record<string, unknown> = {
    outcome: handoff.outcome,
    summary: handoff.summary,
    submittedAt: handoff.submittedAt,
  };
  if (handoff.filesChanged?.length) out.filesChanged = handoff.filesChanged;
  if (handoff.checks?.length) out.checks = handoff.checks;
  if (handoff.blockers?.length) out.blockers = handoff.blockers;
  if (handoff.reviewNotes) out.reviewNotes = handoff.reviewNotes;
  return out;
}

export function overseerReviewToFirestore(review: TaskOverseerReview): Record<string, unknown> {
  const out: Record<string, unknown> = {
    decision: review.decision,
    reviewedAt: review.reviewedAt,
  };
  if (review.reworkInstructions) out.reworkInstructions = review.reworkInstructions;
  if (review.notes) out.notes = review.notes;
  return out;
}
