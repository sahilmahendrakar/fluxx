import type { ValidationArtifactKind } from '../validationRuns/types';
import type { ValidationCheckStatus, ValidationVerdictOutcome } from './types';

export interface ValidationVerdictCheck {
  name: string;
  status: ValidationCheckStatus;
  /** 0-based index into plan.json `checks[]` for this validation run. */
  plannedCheckIndex?: number;
  detail?: string;
  artifactPaths?: string[];
}

export interface ValidationVerdictArtifactRef {
  kind: ValidationArtifactKind;
  label: string;
  path: string;
}

export interface ValidationVerdictDocument {
  verdict: ValidationVerdictOutcome;
  summary: string;
  checks: ValidationVerdictCheck[];
  artifacts?: ValidationVerdictArtifactRef[];
  risks?: string[];
  error?: string;
}

const VERDICT_OUTCOMES: ValidationVerdictOutcome[] = [
  'passed',
  'failed',
  'needs-human-review',
  'errored',
];

const CHECK_STATUSES: ValidationCheckStatus[] = [
  'passed',
  'failed',
  'skipped',
  'needs-human-review',
];

const ARTIFACT_KINDS: ValidationArtifactKind[] = [
  'screenshot',
  'video',
  'trace',
  'console-log',
  'text',
  'json',
];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function parseCheck(raw: unknown): ValidationVerdictCheck | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.name) || typeof r.status !== 'string') return null;
  if (!(CHECK_STATUSES as string[]).includes(r.status)) return null;
  const out: ValidationVerdictCheck = {
    name: r.name.trim(),
    status: r.status as ValidationCheckStatus,
  };
  if (typeof r.detail === 'string' && r.detail.trim()) out.detail = r.detail.trim();
  if (
    typeof r.plannedCheckIndex === 'number' &&
    Number.isInteger(r.plannedCheckIndex) &&
    r.plannedCheckIndex >= 0
  ) {
    out.plannedCheckIndex = r.plannedCheckIndex;
  }
  if (Array.isArray(r.artifactPaths)) {
    const paths = r.artifactPaths.filter(isNonEmptyString).map((p) => p.trim());
    if (paths.length > 0) out.artifactPaths = paths;
  }
  return out;
}

function parseArtifactRef(raw: unknown): ValidationVerdictArtifactRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.kind !== 'string' ||
    !(ARTIFACT_KINDS as string[]).includes(r.kind) ||
    !isNonEmptyString(r.label) ||
    !isNonEmptyString(r.path)
  ) {
    return null;
  }
  return {
    kind: r.kind as ValidationArtifactKind,
    label: r.label.trim(),
    path: r.path.trim(),
  };
}

export type ParseValidationVerdictResult =
  | { ok: true; verdict: ValidationVerdictDocument }
  | { ok: false; error: string };

/** Structural parse for `verdict.json` (ingestion/UI — no JSON Schema engine). */
export function parseValidationVerdictJson(raw: string): ParseValidationVerdictResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Verdict must be an object' };
  }
  const r = parsed as Record<string, unknown>;
  if (typeof r.verdict !== 'string' || !(VERDICT_OUTCOMES as string[]).includes(r.verdict)) {
    return { ok: false, error: 'Invalid or missing verdict' };
  }
  if (!isNonEmptyString(r.summary)) {
    return { ok: false, error: 'Invalid or missing summary' };
  }
  if (!Array.isArray(r.checks) || r.checks.length === 0) {
    return { ok: false, error: 'checks must be a non-empty array' };
  }
  const checks: ValidationVerdictCheck[] = [];
  for (const item of r.checks) {
    const check = parseCheck(item);
    if (!check) return { ok: false, error: 'Invalid check entry' };
    checks.push(check);
  }
  const out: ValidationVerdictDocument = {
    verdict: r.verdict as ValidationVerdictOutcome,
    summary: r.summary.trim(),
    checks,
  };
  if (Array.isArray(r.artifacts)) {
    const artifacts: ValidationVerdictArtifactRef[] = [];
    for (const item of r.artifacts) {
      const ref = parseArtifactRef(item);
      if (!ref) return { ok: false, error: 'Invalid artifacts entry' };
      artifacts.push(ref);
    }
    if (artifacts.length > 0) out.artifacts = artifacts;
  }
  if (Array.isArray(r.risks)) {
    const risks = r.risks.filter(isNonEmptyString).map((s) => s.trim());
    if (risks.length > 0) out.risks = risks;
  }
  if (typeof r.error === 'string' && r.error.trim()) out.error = r.error.trim();
  return { ok: true, verdict: out };
}
