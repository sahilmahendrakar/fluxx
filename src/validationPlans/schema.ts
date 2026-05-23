import { isKnownValidationPackId } from '../validationPacks/types';
import type { TaskValidationPlan } from '../types';

export type { TaskValidationPlan };

export type ParseTaskValidationPlanResult =
  | { ok: true; plan: TaskValidationPlan }
  | { ok: false; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function parseStringArray(raw: unknown, field: string, allowEmpty: boolean): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) {
      return null;
    }
    out.push(item.trim());
  }
  if (!allowEmpty && out.length === 0) return null;
  return out;
}

function parseOptionalStringArray(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  const parsed = parseStringArray(raw, 'risks', true);
  return parsed ?? undefined;
}

/** Structural validation for a task validation plan object or JSON string. */
export function parseTaskValidationPlan(raw: unknown): ParseTaskValidationPlanResult {
  let value = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { ok: false, error: 'Validation plan JSON is empty' };
    }
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return { ok: false, error: 'Validation plan is not valid JSON' };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Validation plan must be a JSON object' };
  }
  const r = value as Record<string, unknown>;
  if (!isNonEmptyString(r.goal)) {
    return { ok: false, error: 'Validation plan requires a non-empty goal' };
  }
  if (typeof r.pack !== 'string' || !isKnownValidationPackId(r.pack)) {
    return { ok: false, error: 'Validation plan requires a supported pack id' };
  }
  const checks = parseStringArray(r.checks, 'checks', false);
  if (!checks) {
    return { ok: false, error: 'Validation plan checks must be a non-empty string array' };
  }
  const requiredArtifacts = parseStringArray(r.requiredArtifacts, 'requiredArtifacts', true);
  if (!requiredArtifacts) {
    return {
      ok: false,
      error: 'Validation plan requiredArtifacts must be a string array',
    };
  }
  const risks = parseOptionalStringArray(r.risks);
  if (r.risks !== undefined && risks === undefined) {
    return { ok: false, error: 'Validation plan risks must be a string array when present' };
  }
  const plan: TaskValidationPlan = {
    goal: r.goal.trim(),
    pack: r.pack,
    checks,
    requiredArtifacts,
  };
  if (typeof r.notes === 'string' && r.notes.trim()) {
    plan.notes = r.notes.trim();
  }
  if (risks && risks.length > 0) {
    plan.risks = risks;
  }
  return { ok: true, plan };
}

export function taskValidationPlanToJson(plan: TaskValidationPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}
