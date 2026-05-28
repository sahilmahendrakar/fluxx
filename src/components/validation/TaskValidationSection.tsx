import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
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
    <section className="border-t border-border px-5 py-5" aria-label="Validation">
      <Card className="shadow-none">
        <CardContent className="flex flex-col gap-3 p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-4 shrink-0 text-status-review" strokeWidth={2} aria-hidden />
                Validation
              </h2>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                Run the Electron Playwright pack to collect evidence. Passing validation does not mark
                this task done — review the artifacts and decide next steps.
              </p>
            </div>
            <ValidationStatusBadge status={boardBadge} loading={loading && !latestRun} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="bg-status-review text-status-review-foreground hover:bg-status-review/90"
              onClick={() => void handleRunValidation()}
              disabled={runBtnDisabled}
              title={eligibility.message}
            >
              {runBusy ? <Spinner /> : null}
              {runBusy ? 'Starting validation…' : 'Run validation'}
            </Button>
            {task.status !== 'validation' ? (
              <span className="text-xs text-muted-foreground">Available when the task is in Validation.</span>
            ) : null}
          </div>

          {runError ? (
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{runError}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : null}
          {!eligibility.canRun && eligibility.message && task.status === 'validation' && !runError ? (
            <p className="text-xs leading-snug text-muted-foreground">{eligibility.message}</p>
          ) : null}

          <TaskValidationPlanEditor task={task} onUpdate={onUpdate} />

          {loading && runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading validation history…</p>
          ) : null}

          {!loading && runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No validation runs yet for this task.</p>
          ) : null}

          {displayRun ? (
            <div className="flex flex-col gap-4">
              <Separator />
              {sortedRuns.length > 1 ? (
                <div className="flex flex-col gap-2">
                  <Label
                    htmlFor={`validation-run-select-${task.id}`}
                    className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    Validation run
                  </Label>
                  <Select
                    value={selectedRunId ?? displayRun.id}
                    onValueChange={(value) => setSelectedRunId(value)}
                  >
                    <SelectTrigger id={`validation-run-select-${task.id}`} className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedRuns.map((run) => (
                        <SelectItem key={run.id} value={run.id} className="text-xs">
                          {validationRunPickerLabel(run)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className={`font-medium ${validationRunStatusDetailClass(displayRun.status)}`}>
                    {validationRunStatusLabel(displayRun.status)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pack</dt>
                  <dd>{validationPackDisplayName(displayRun.packId)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Validator</dt>
                  <dd>{validatorLabel ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Started</dt>
                  <dd>{formatValidationTimestamp(displayRun.startedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Completed</dt>
                  <dd>{formatValidationTimestamp(displayRun.completedAt)}</dd>
                </div>
              </dl>

              {displayRun.summary?.trim() ? (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Summary
                  </p>
                  <p className="text-sm leading-relaxed">{displayRun.summary}</p>
                </div>
              ) : null}

              {plannedCheckRows.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Planned vs verdict checks
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {plannedCheckRows.map((row) => (
                      <li
                        key={row.name}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs"
                      >
                        <span>{row.name}</span>
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
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Verdict reason
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{displayRun.verdictReason}</p>
                </div>
              ) : null}

              {verdictRisks.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Risks
                  </p>
                  <ul className="list-disc flex flex-col gap-1 pl-4 text-sm leading-relaxed text-status-needs-input-foreground">
                    {verdictRisks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {displayRun.status === 'errored' ? (
                <Alert className="border-status-needs-input/30 bg-status-needs-input/10 text-status-needs-input-foreground">
                  <AlertDescription className="text-xs leading-relaxed">
                    Validation could not complete because of a setup or tooling failure. Check validator
                    session output and try again after fixing the environment.
                  </AlertDescription>
                </Alert>
              ) : null}

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Artifacts
                </p>
                <ValidationArtifactList runId={displayRun.id} artifacts={displayRun.artifacts} />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
