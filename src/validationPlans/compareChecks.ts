import type { ValidationVerdictCheck } from '../validationPacks/verdict';

export type PlannedCheckRow = {
  name: string;
  verdictStatus?: ValidationVerdictCheck['status'];
  verdictDetail?: string;
};

/** Align planned check strings with verdict check names (case-insensitive substring match). */
export function matchPlannedChecksToVerdict(
  plannedChecks: string[],
  verdictChecks: ValidationVerdictCheck[],
): PlannedCheckRow[] {
  const used = new Set<number>();
  return plannedChecks.map((planned) => {
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
    if (bestIdx >= 0 && bestScore > 0) {
      used.add(bestIdx);
      const match = verdictChecks[bestIdx];
      return {
        name: planned,
        verdictStatus: match.status,
        ...(match.detail ? { verdictDetail: match.detail } : {}),
      };
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
