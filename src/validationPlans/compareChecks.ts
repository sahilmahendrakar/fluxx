import type { ValidationVerdictCheck } from '../validationPacks/verdict';
import type { ValidationCheckStatus } from '../validationPacks/types';

export type PlannedCheckRow = {
  name: string;
  verdictStatus?: ValidationVerdictCheck['status'];
  verdictDetail?: string;
  matchMethod?: 'index' | 'name';
};

const STATUS_PRECEDENCE: ValidationCheckStatus[] = [
  'failed',
  'needs-human-review',
  'skipped',
  'passed',
];

function aggregateCheckStatuses(statuses: ValidationCheckStatus[]): ValidationCheckStatus | undefined {
  if (statuses.length === 0) return undefined;
  for (const status of STATUS_PRECEDENCE) {
    if (statuses.includes(status)) return status;
  }
  return statuses[0];
}

function aggregateDetails(checks: ValidationVerdictCheck[]): string | undefined {
  const parts = checks
    .map((check) => check.detail?.trim())
    .filter((detail): detail is string => Boolean(detail));
  if (parts.length === 0) return undefined;
  return parts.join(' · ');
}

function rowFromChecks(
  name: string,
  checks: ValidationVerdictCheck[],
  matchMethod: PlannedCheckRow['matchMethod'],
): PlannedCheckRow {
  const verdictStatus = aggregateCheckStatuses(checks.map((check) => check.status));
  const verdictDetail = aggregateDetails(checks);
  return {
    name,
    ...(verdictStatus ? { verdictStatus } : {}),
    ...(verdictDetail ? { verdictDetail } : {}),
    ...(matchMethod ? { matchMethod } : {}),
  };
}

function isValidPlannedCheckIndex(index: unknown, plannedCount: number): index is number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < plannedCount;
}

/** Legacy fallback: case-insensitive exact or substring match on check names. */
function matchPlannedNameToVerdictChecks(
  planned: string,
  verdictChecks: ValidationVerdictCheck[],
  used: Set<number>,
): ValidationVerdictCheck[] {
  const plannedLower = planned.toLowerCase();
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < verdictChecks.length; i += 1) {
    if (used.has(i)) continue;
    const name = verdictChecks[i].name.toLowerCase();
    const score =
      name === plannedLower
        ? 3
        : name.includes(plannedLower) || plannedLower.includes(name)
          ? 2
          : 0;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestScore === 0) return [];
  used.add(bestIdx);
  return [verdictChecks[bestIdx]];
}

/**
 * Align planned checks with verdict checks.
 * Prefers `plannedCheckIndex` (0-based, matches plan.json `checks[]` order).
 * Falls back to legacy name matching for older verdict files.
 */
export function matchPlannedChecksToVerdict(
  plannedChecks: string[],
  verdictChecks: ValidationVerdictCheck[],
): PlannedCheckRow[] {
  const byIndex = new Map<number, ValidationVerdictCheck[]>();
  const unindexed: ValidationVerdictCheck[] = [];

  for (const check of verdictChecks) {
    if (isValidPlannedCheckIndex(check.plannedCheckIndex, plannedChecks.length)) {
      const bucket = byIndex.get(check.plannedCheckIndex) ?? [];
      bucket.push(check);
      byIndex.set(check.plannedCheckIndex, bucket);
    } else {
      unindexed.push(check);
    }
  }

  const usedUnindexed = new Set<number>();

  return plannedChecks.map((planned, plannedIndex) => {
    const indexed = byIndex.get(plannedIndex);
    if (indexed?.length) {
      return rowFromChecks(planned, indexed, 'index');
    }

    const legacyMatches = matchPlannedNameToVerdictChecks(planned, unindexed, usedUnindexed);
    if (legacyMatches.length > 0) {
      return rowFromChecks(planned, legacyMatches, 'name');
    }

    return { name: planned };
  });
}

export function verdictCheckStatusClass(status: ValidationVerdictCheck['status'] | undefined): string {
  switch (status) {
    case 'passed':
      return 'text-emerald-300/90';
    case 'failed':
      return 'text-red-300/90';
    case 'needs-human-review':
      return 'text-amber-200/90';
    case 'skipped':
      return 'text-zinc-400';
    default:
      return 'text-zinc-500';
  }
}
