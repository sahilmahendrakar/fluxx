import { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import type { Task } from '../../types';
import { AGENTS } from '../../types';
import type { ProjectRepoReadiness } from '../../projectRepoReadiness';
import { projectRepoActionsBlocked } from '../../projectRepoReadiness';
import {
  evaluateManualValidationEligibility,
  formatValidationTimestamp,
  validationBoardBadgeFromRuns,
  validationPackDisplayName,
  validationRunStatusDetailClass,
  validationRunStatusLabel,
} from '../../validationRuns/display';
import { runManualValidationForTask } from '../../validationRuns/manualValidationAction';
import { useTaskValidationRuns } from '../../validationRuns/useTaskValidationRuns';
import ValidationArtifactList from './ValidationArtifactList';
import ValidationStatusBadge from './ValidationStatusBadge';

export default function TaskValidationSection({
  task,
  primaryRepoId,
  worktreePath,
  projectRepoReadiness,
}: {
  task: Task;
  primaryRepoId: string;
  worktreePath?: string | null;
  projectRepoReadiness?: ProjectRepoReadiness;
}) {
  const { runs, latestRun, loading, error, refresh } = useTaskValidationRuns(task.id);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [verdictRisks, setVerdictRisks] = useState<string[]>([]);

  const repoBlocked = projectRepoReadiness
    ? projectRepoActionsBlocked(projectRepoReadiness)
    : false;

  const eligibility = useMemo(
    () =>
      evaluateManualValidationEligibility({
        task,
        latestRun,
        repoBlocked,
      }),
    [task, latestRun, repoBlocked],
  );

  const boardBadge = validationBoardBadgeFromRuns(runs);
  const validatorLabel =
    AGENTS.find((a) => a.id === latestRun?.validatorAgent)?.label ?? latestRun?.validatorAgent;

  useEffect(() => {
    setVerdictRisks([]);
    if (!latestRun?.id) return;
    if (latestRun.status === 'queued' || latestRun.status === 'running') return;
    let cancelled = false;
    void window.electronAPI.validationRuns.readVerdict(latestRun.id).then((result) => {
      if (cancelled || !result.ok) return;
      setVerdictRisks(result.verdict.risks ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [latestRun?.id, latestRun?.status]);

  const handleRunValidation = async () => {
    setRunError(null);
    setRunBusy(true);
    try {
      const result = await runManualValidationForTask({
        task,
        primaryRepoId,
        worktreePath,
      });
      if (!result.ok) {
        setRunError(result.error);
        return;
      }
      refresh();
    } finally {
      setRunBusy(false);
    }
  };

  const runBtnDisabled = runBusy || !eligibility.canRun;

  return (
    <section className="border-t border-white/[0.04] px-5 py-5" aria-label="Validation">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <ShieldCheck className="h-4 w-4 shrink-0 text-sky-400/80" strokeWidth={2} aria-hidden />
              Validation
            </h2>
            <p className="mt-1 text-[11px] leading-snug text-zinc-500">
              Run the Electron Playwright pack to collect evidence. Passing validation does not mark
              this task done — review the artifacts and decide next steps.
            </p>
          </div>
          <ValidationStatusBadge status={boardBadge} loading={loading && !latestRun} />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRunValidation()}
            disabled={runBtnDisabled}
            title={eligibility.message}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500/90 px-3 py-1.5 text-[12px] font-medium text-sky-950 transition hover:bg-sky-400/90 disabled:cursor-not-allowed disabled:bg-zinc-800/80 disabled:text-zinc-500"
          >
            {runBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden />
            ) : null}
            {runBusy ? 'Starting validation…' : 'Run validation'}
          </button>
          {task.status !== 'review' ? (
            <span className="text-[11px] text-zinc-500">Available when the task is in Review.</span>
          ) : null}
        </div>

        {runError ? (
          <p className="mb-3 text-[11px] leading-snug text-red-300/90" role="alert">
            {runError}
          </p>
        ) : null}
        {error ? (
          <p className="mb-3 text-[11px] leading-snug text-red-300/90" role="alert">
            {error}
          </p>
        ) : null}
        {!eligibility.canRun && eligibility.message && task.status === 'review' && !runError ? (
          <p className="mb-3 text-[11px] leading-snug text-zinc-500">{eligibility.message}</p>
        ) : null}

        {loading && runs.length === 0 ? (
          <p className="text-xs text-zinc-600">Loading validation history…</p>
        ) : null}

        {!loading && runs.length === 0 ? (
          <p className="text-xs text-zinc-600">No validation runs yet for this task.</p>
        ) : null}

        {latestRun ? (
          <div className="space-y-4 border-t border-white/[0.04] pt-3">
            <dl className="grid gap-2 text-[12px] sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">Status</dt>
                <dd className={`font-medium ${validationRunStatusDetailClass(latestRun.status)}`}>
                  {validationRunStatusLabel(latestRun.status)}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Pack</dt>
                <dd className="text-zinc-200">{validationPackDisplayName(latestRun.packId)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Validator</dt>
                <dd className="text-zinc-200">{validatorLabel ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Started</dt>
                <dd className="text-zinc-200">{formatValidationTimestamp(latestRun.startedAt)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Completed</dt>
                <dd className="text-zinc-200">{formatValidationTimestamp(latestRun.completedAt)}</dd>
              </div>
            </dl>

            {latestRun.summary?.trim() ? (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                  Summary
                </p>
                <p className="text-[13px] leading-relaxed text-zinc-300">{latestRun.summary}</p>
              </div>
            ) : null}

            {latestRun.verdictReason?.trim() ? (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                  Verdict reason
                </p>
                <p className="text-[13px] leading-relaxed text-zinc-400">{latestRun.verdictReason}</p>
              </div>
            ) : null}

            {verdictRisks.length > 0 ? (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                  Risks
                </p>
                <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-amber-100/90">
                  {verdictRisks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {latestRun.status === 'errored' ? (
              <p className="rounded-lg border border-orange-500/25 bg-orange-500/[0.08] px-3 py-2 text-[12px] leading-relaxed text-orange-100/90">
                Validation could not complete because of a setup or tooling failure. Check validator
                session output and try again after fixing the environment.
              </p>
            ) : null}

            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                Artifacts
              </p>
              <ValidationArtifactList runId={latestRun.id} artifacts={latestRun.artifacts} />
            </div>

            {runs.length > 1 ? (
              <p className="text-[11px] text-zinc-600">
                Showing latest of {runs.length} validation runs.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
