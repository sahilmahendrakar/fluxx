import fs from 'node:fs/promises';
import path from 'node:path';
import { parseValidationVerdictJson } from '../validationPacks/verdict';
import type { ValidationVerdictArtifactRef } from '../validationPacks/verdict';
import type { ValidationVerdictOutcome } from '../validationPacks/types';
import { normalizeValidationRunRelativePath } from '../validationRuns/path';
import type { ValidationRun, ValidationRunStatus } from '../validationRuns/types';
import type { ValidationRunStore } from './ValidationRunStore';

const VERDICT_FILENAME = 'verdict.json';

const TERMINAL_STATUSES: ValidationRunStatus[] = [
  'passed',
  'failed',
  'needs-human-review',
  'errored',
  'cancelled',
];

function verdictOutcomeToRunStatus(outcome: ValidationVerdictOutcome): ValidationRunStatus {
  return outcome;
}

export type ValidationVerdictIngestResult =
  | { ok: true; run: ValidationRun; ingested: boolean }
  | { ok: false; error: string };

async function readVerdictFile(runDir: string): Promise<
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'present'; raw: string }
> {
  const verdictPath = path.join(runDir, VERDICT_FILENAME);
  try {
    const raw = await fs.readFile(verdictPath, 'utf8');
    return { kind: 'present', raw };
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as NodeJS.ErrnoException).code
        : undefined;
    if (code === 'ENOENT') return { kind: 'missing' };
    return {
      kind: 'unreadable',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function collectArtifactRefs(
  verdictArtifacts: ValidationVerdictArtifactRef[] | undefined,
  checks: { artifactPaths?: string[] }[],
): ValidationVerdictArtifactRef[] {
  const byPath = new Map<string, ValidationVerdictArtifactRef>();
  for (const ref of verdictArtifacts ?? []) {
    const norm = normalizeValidationRunRelativePath(ref.path);
    if (!norm) continue;
    byPath.set(norm, { ...ref, path: norm });
  }
  for (const check of checks) {
    for (const p of check.artifactPaths ?? []) {
      const norm = normalizeValidationRunRelativePath(p);
      if (!norm || byPath.has(norm)) continue;
      byPath.set(norm, { kind: 'text', label: check.name ?? norm, path: norm });
    }
  }
  return [...byPath.values()];
}

/**
 * Reads `<runDir>/verdict.json`, registers artifact metadata, and updates run status.
 * Missing or invalid verdicts never mark a run passed.
 */
export async function ingestValidationVerdict(
  store: ValidationRunStore,
  runId: string,
): Promise<ValidationVerdictIngestResult> {
  const existing = await store.get(runId);
  if (!existing) {
    return { ok: false, error: `Validation run not found: ${runId}` };
  }
  if (TERMINAL_STATUSES.includes(existing.status)) {
    return { ok: true, run: existing, ingested: false };
  }

  const file = await readVerdictFile(existing.artifactDir);
  if (file.kind === 'missing') {
    const run = await store.updateStatus({
      runId,
      status: 'needs-human-review',
      summary: existing.summary,
      verdictReason: 'Verdict file missing',
    });
    return { ok: true, run, ingested: true };
  }
  if (file.kind === 'unreadable') {
    const run = await store.updateStatus({
      runId,
      status: 'errored',
      summary: existing.summary,
      verdictReason: `Could not read verdict file: ${file.error}`,
    });
    return { ok: true, run, ingested: true };
  }

  const parsed = parseValidationVerdictJson(file.raw);
  if (!parsed.ok) {
    const run = await store.updateStatus({
      runId,
      status: 'needs-human-review',
      summary: existing.summary,
      verdictReason: parsed.error,
    });
    return { ok: true, run, ingested: true };
  }

  const { verdict } = parsed;
  const status = verdictOutcomeToRunStatus(verdict.verdict);
  const existingPaths = new Set(existing.artifacts.map((a) => a.path));
  const refs = collectArtifactRefs(verdict.artifacts, verdict.checks);
  let run = existing;
  for (const ref of refs) {
    const norm = normalizeValidationRunRelativePath(ref.path);
    if (!norm || existingPaths.has(norm)) continue;
    run = await store.registerArtifact({
      runId,
      kind: ref.kind,
      label: ref.label,
      path: norm,
    });
    existingPaths.add(norm);
  }

  run = await store.updateStatus({
    runId,
    status,
    summary: verdict.summary,
    ...(verdict.error ? { verdictReason: verdict.error } : {}),
  });

  return { ok: true, run, ingested: true };
}
