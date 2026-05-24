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

function runMatchesParsedVerdict(
  run: ValidationRun,
  status: ValidationRunStatus,
  summary: string | undefined,
  verdictReason: string | undefined,
): boolean {
  const normalizedReason = (value: string | undefined) => value?.trim() ?? '';
  return (
    run.status === status &&
    (run.summary ?? '') === (summary ?? '') &&
    normalizedReason(run.verdictReason) === normalizedReason(verdictReason)
  );
}

async function registerMissingArtifacts(
  store: ValidationRunStore,
  run: ValidationRun,
  refs: ValidationVerdictArtifactRef[],
): Promise<{ run: ValidationRun; added: boolean }> {
  const existingPaths = new Set(run.artifacts.map((artifact) => artifact.path));
  let next = run;
  let added = false;
  for (const ref of refs) {
    const norm = normalizeValidationRunRelativePath(ref.path);
    if (!norm || existingPaths.has(norm)) continue;
    next = await store.registerArtifact({
      runId: run.id,
      kind: ref.kind,
      label: ref.label,
      path: norm,
    });
    existingPaths.add(norm);
    added = true;
  }
  return { run: next, added };
}

/**
 * Reads `<runDir>/verdict.json`, registers artifact metadata, and updates run status.
 * Missing or invalid verdicts never mark a run passed.
 * Terminal runs re-ingest when on-disk verdict would change status, summary, or reason.
 */
export async function ingestValidationVerdict(
  store: ValidationRunStore,
  runId: string,
): Promise<ValidationVerdictIngestResult> {
  const existing = await store.get(runId);
  if (!existing) {
    return { ok: false, error: `Validation run not found: ${runId}` };
  }

  const isTerminal = TERMINAL_STATUSES.includes(existing.status);
  const file = await readVerdictFile(existing.artifactDir);

  if (isTerminal) {
    if (file.kind === 'missing') {
      return { ok: true, run: existing, ingested: false };
    }
    if (file.kind === 'unreadable') {
      const verdictReason = `Could not read verdict file: ${file.error}`;
      if (runMatchesParsedVerdict(existing, 'errored', existing.summary, verdictReason)) {
        return { ok: true, run: existing, ingested: false };
      }
      const run = await store.updateStatus({
        runId,
        status: 'errored',
        summary: existing.summary,
        verdictReason,
      });
      return { ok: true, run, ingested: true };
    }

    const parsed = parseValidationVerdictJson(file.raw);
    if (!parsed.ok) {
      if (runMatchesParsedVerdict(existing, 'needs-human-review', existing.summary, parsed.error)) {
        return { ok: true, run: existing, ingested: false };
      }
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
    const verdictReason = verdict.error;
    const refs = collectArtifactRefs(verdict.artifacts, verdict.checks);
    const { run: withArtifacts, added } = await registerMissingArtifacts(store, existing, refs);
    if (
      !added &&
      runMatchesParsedVerdict(withArtifacts, status, verdict.summary, verdictReason)
    ) {
      return { ok: true, run: withArtifacts, ingested: false };
    }

    const run = await store.updateStatus({
      runId,
      status,
      summary: verdict.summary,
      verdictReason: verdict.error ?? '',
    });
    return { ok: true, run, ingested: true };
  }

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
  const refs = collectArtifactRefs(verdict.artifacts, verdict.checks);
  await registerMissingArtifacts(store, existing, refs);

  const run = await store.updateStatus({
    runId,
    status,
    summary: verdict.summary,
    verdictReason: verdict.error ?? '',
  });

  return { ok: true, run, ingested: true };
}
