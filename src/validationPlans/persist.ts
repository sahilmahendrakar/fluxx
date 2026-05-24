import { parseTaskValidationPlan, type TaskValidationPlan } from './schema';

export type ParseCliValidationPlanInputResult =
  | { ok: true; plan: TaskValidationPlan }
  | { ok: false; error: string };

/** Parses `--validation-plan` CLI value (JSON object string). */
export function parseCliValidationPlanInput(raw: unknown): ParseCliValidationPlanInputResult {
  if (raw === undefined || raw === null) {
    return { ok: false, error: 'Validation plan value is required' };
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const parsed = parseTaskValidationPlan(raw);
    if (!parsed.ok) return parsed;
    return { ok: true, plan: parsed.plan };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Validation plan must be a JSON object or JSON string' };
  }
  return parseTaskValidationPlan(raw);
}

export function parsePersistedTaskValidationPlan(
  raw: unknown,
): TaskValidationPlan | null {
  if (raw == null) return null;
  const parsed = parseTaskValidationPlan(raw);
  return parsed.ok ? parsed.plan : null;
}

export function validationPlanToFirestore(plan: TaskValidationPlan): Record<string, unknown> {
  const out: Record<string, unknown> = {
    goal: plan.goal,
    pack: plan.pack,
    checks: plan.checks,
    requiredArtifacts: plan.requiredArtifacts,
  };
  if (plan.risks?.length) out.risks = plan.risks;
  if (plan.notes?.trim()) out.notes = plan.notes.trim();
  return out;
}
