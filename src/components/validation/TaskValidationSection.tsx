import { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import type { Task } from '../../types';
import type { TaskPatch } from '../../renderer/tasks/TaskProvider';
import { AGENTS } from '../../types';
import type { ProjectRepoReadiness } from '../../projectRepoReadiness';
import { projectRepoActionsBlocked } from '../../projectRepoReadiness';
import {
  evaluateManualValidationEligibility,
  formatValidationTimestamp,
  sortValidationRunsNewestFirst,
  validationBoardBadgeFromRuns,
  validationPackDisplayName,
  validationRunPickerLabel,
  validationRunStatusDetailClass,
  validationRunStatusLabel,
} from '../../validationRuns/display';
import { runManualValidationForTask } from '../../validationRuns/manualValidationAction';
import { useTaskValidationRuns } from '../../validationRuns/useTaskValidationRuns';
import ValidationArtifactList from './ValidationArtifactList';
import ValidationStatusBadge from './ValidationStatusBadge';
import type { ValidationVerdictCheck } from '../../validationPacks/verdict';
import {
  matchPlannedChecksToVerdict,
  verdictCheckStatusClass,
} from '../../validationPlans/compareChecks';
import TaskValidationPlanEditor from './TaskValidationPlanEditor';

export default function TaskValidationSection({
  task,
  primaryRepoId,
  worktreePath,
  projectRepoReadiness,
  onUpdate,
}: {
  task: Task;
  primaryRepoId: string;
  worktreePath?: string | null;
  projectRepoReadiness?: ProjectRepoReadiness;
  onUpdate: (id: string, patch: TaskPatch) => void;
}) {
  const {
    runs,
    latestRun,
    selectedRun,
    selectedRunId,
    setSelectedRunId,
    loading,
    error,
    refresh,
  } = useTaskValidationRuns(task.id);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [verdictRisks, setVerdictRisks] = useState<string[]>([]);
  const [verdictChecks, setVerdictChecks] = useState<ValidationVerdictCheck[]>([]);

  const displayRun = selectedRun ?? latestRun;
  const sortedRuns = useMemo(() => sortValidationRunsNewestFirst(runs), [runs]);

  const plannedCheckRows = useMemo(
    () =>
      task.validationPlan?.checks?.length
        ? matchPlannedChecksToVerdict(task.validationPlan.checks, verdictChecks)
        : [],
    [task.validationPlan?.checks, verdictChecks],
  );

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
    AGENTS.find((a) => a.id === displayRun?.validatorAgent)?.label ?? displayRun?.validatorAgent;

  useEffect(() => {
    setVerdictRisks([]);
    setVerdictChecks([]);
    if (!displayRun?.id) return;
    if (displayRun.status === 'queued' || displayRun.status === 'running') return;
    let cancelled = false;
    void window.electronAPI.validationRuns.readVerdict(displayRun.id).then((result) => {
      if (cancelled || !result.ok) return;
      setVerdictRisks(result.verdict.risks ?? []);
      setVerdictChecks(result.verdict.checks ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [displayRun?.id, displayRun?.status]);

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
          {task.status !== 'validation' ? (
            <span className="text-[11px] text-zinc-500">
              Available when the task is in Validation.
            </span>
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
        {!eligibility.canRun && eligibility.message && task.status === 'validation' && !runError ? (
          <p className="mb-3 text-[11px] leading-snug text-zinc-500">{eligibility.message}</p>
        ) : null}

        <div className="mb-4">
          <TaskValidationPlanEditor task={task} onUpdate={onUpdate} />
        </div>

        {loading && runs.length === 0 ? (
          <p className="text-xs text-zinc-600">Loading validation history…</p>
        ) : null}

        {!loading && runs.length === 0 ? (
          <p className="text-xs text-zinc-600">No validation runs yet for this task.</p>
        ) : null}

        {displayRun ? (
          <div className="space-y-4 border-t border-white/[0.04] pt-3">
            {sortedRuns.length > 1 ? (
              <div>
                <label
                  htmlFor={`validation-run-select-${task.id}`}
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500"
                >
                  Validation run
                </label>
                <select
                  id={`validation-run-select-${task.id}`}
                  value={selectedRunId ?? displayRun.id}
                  onChange={(event) => setSelectedRunId(event.target.value)}
                  className="w-full max-w-full rounded-lg border border-white/[0.08] bg-zinc-900/80 px-2.5 py-1.5 text-[12px] text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
                >
                  {sortedRuns.map((run) => (
                    <option key={run.id} value={run.id}>
                      {validationRunPickerLabel(run)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <dl className="grid gap-2 text-[12px] sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">Status</dt>
                <dd className={`font-medium ${validationRunStatusDetailClass(displayRun.status)}`}>
                  {validationRunStatusLabel(displayRun.status)}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Pack</dt>
                <dd className="text-zinc-200">{validationPackDisplayName(displayRun.packId)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Validator</dt>
                <dd className="text-zinc-200">{validatorLabel ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Started</dt>
                <dd className="text-zinc-200">{formatValidationTimestamp(displayRun.startedAt)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Completed</dt>
                <dd className="text-zinc-200">{formatValidationTimestamp(displayRun.completedAt)}</dd>
              </div>
            </dl>

            {displayRun.summary?.trim() ? (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                  Summary
                </p>
                <p className="text-[13px] leading-relaxed text-zinc-300">{displayRun.summary}</p>
              </div>
            ) : null}

            {plannedCheckRows.length > 0 ? (
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                  Planned vs verdict checks
                </p>
                <ul className="space-y-1.5">
                  {plannedCheckRows.map((row) => (
                    <li
                      key={row.name}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5 text-[12px]"
                    >
                      <span className="text-zinc-300">{row.name}</span>
                      <span className={`font-medium ${verdictCheckStatusClass(row.verdictStatus)}`}>
                        {row.verdictStatus ?? 'not run'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {displayRun.verdictReason?.trim() ? (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                  Verdict reason
                </p>
                <p className="text-[13px] leading-relaxed text-zinc-400">{displayRun.verdictReason}</p>
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

            {displayRun.status === 'errored' ? (
              <p className="rounded-lg border border-orange-500/25 bg-orange-500/[0.08] px-3 py-2 text-[12px] leading-relaxed text-orange-100/90">
                Validation could not complete because of a setup or tooling failure. Check validator
                session output and try again after fixing the environment.
              </p>
            ) : null}

            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                Artifacts
              </p>
              <ValidationArtifactList runId={displayRun.id} artifacts={displayRun.artifacts} />
            </div>

          </div>
        ) : null}
      </div>
    </section>
  );
}
