import fs from 'node:fs/promises';
import path from 'node:path';
import type { Session } from '../types';
import type { ValidationRun } from '../validationRuns/types';
import {
  captureGitStatusPorcelain,
  compareGitStatusPorcelain,
} from './gitStatusGuardrail';
import type { ValidationRunStore } from './ValidationRunStore';
import { ingestValidationVerdict } from './validationVerdictIngest';

async function writeGuardrailsLog(
  runDir: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await fs.writeFile(
    path.join(runDir, 'guardrails.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

export type FinalizeValidationRunInput = {
  runId: string;
  /** When finalizing because the validator PTY exited. */
  session?: Pick<Session, 'id' | 'status'>;
  source: 'finish' | 'session-exit';
};

export type FinalizeValidationRunResult =
  | { ok: true; run: ValidationRun; ingested: boolean }
  | { ok: false; error: string };

/**
 * Captures post-validation git guardrails, ingests verdict.json, and transitions the run
 * to a terminal status. Safe to call multiple times; terminal runs re-ingest when on-disk
 * verdict would change status, summary, or reason (`ingested: false` when unchanged).
 */
export async function finalizeValidationRun(
  store: ValidationRunStore,
  input: FinalizeValidationRunInput,
): Promise<FinalizeValidationRunResult> {
  const runId = input.runId.trim();
  const existing = await store.get(runId);
  if (!existing) {
    return { ok: false, error: `Validation run not found: ${runId}` };
  }

  let run = existing;

  const worktreeCwd = existing.worktreeCwd?.trim();
  if (worktreeCwd) {
    const postStatus = await captureGitStatusPorcelain(worktreeCwd);
    const preSnapshot = {
      porcelain: existing.gitGuardrails?.preValidationGitStatus ?? '',
      capturedAt: existing.startedAt,
    };
    const comparison = compareGitStatusPorcelain(preSnapshot, postStatus);
    const needsGuardrailUpdate =
      existing.gitGuardrails?.postValidationGitStatus === undefined ||
      input.source === 'finish';
    if (needsGuardrailUpdate) {
      run = await store.updateGuardrails({
        runId,
        postValidationGitStatus: postStatus.porcelain,
        gitStatusDriftDetected: comparison.driftDetected,
      });
      await writeGuardrailsLog(existing.artifactDir, {
        preValidationGitStatus: preSnapshot.porcelain,
        postValidationGitStatus: postStatus.porcelain,
        gitStatusDriftDetected: comparison.driftDetected,
        ...(comparison.driftSummary ? { driftSummary: comparison.driftSummary } : {}),
        ...(input.session?.id ? { validatorSessionId: input.session.id } : {}),
        ...(input.session?.status ? { sessionExitStatus: input.session.status } : {}),
        finalizedAt: new Date().toISOString(),
        finalizeSource: input.source,
      });
    }
  }

  if (
    input.source === 'session-exit' &&
    input.session?.status === 'error' &&
    run.status === 'running'
  ) {
    run = await store.updateStatus({
      runId,
      status: 'errored',
      verdictReason: 'Validator agent exited with an error before producing a verdict.',
    });
    return { ok: true, run, ingested: true };
  }

  const ingest = await ingestValidationVerdict(store, runId);
  if (!ingest.ok) {
    return { ok: false, error: ingest.error };
  }
  return { ok: true, run: ingest.run, ingested: ingest.ingested };
}
