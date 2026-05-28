import { useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { Task, TaskValidationPlan } from '../../types';
import type { TaskPatch } from '../../renderer/tasks/TaskProvider';
import { parseTaskValidationPlan, taskValidationPlanToJson } from '../../validationPlans/schema';

const EXAMPLE_PLAN: TaskValidationPlan = {
  goal: 'Verify the task-specific behavior and capture all evidence',
  pack: 'electron-playwright',
  checks: ['Launch the app', 'Exercise the changed UI flow', 'Capture screenshots'],
  requiredArtifacts: ['primary-flow-screenshot'],
};

export default function TaskValidationPlanEditor({
  task,
  onUpdate,
}: {
  task: Task;
  onUpdate: (id: string, patch: TaskPatch) => void;
}) {
  const storedJson = useMemo(
    () => (task.validationPlan ? taskValidationPlanToJson(task.validationPlan).trimEnd() : ''),
    [task.validationPlan],
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(storedJson);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(storedJson);
      setLocalError(null);
    }
  }, [storedJson, editing, task.id]);

  const parsedStored = task.validationPlan ? parseTaskValidationPlan(task.validationPlan) : null;
  const storedInvalid =
    task.validationPlan != null && parsedStored != null && !parsedStored.ok ? parsedStored.error : null;

  const handleSave = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onUpdate(task.id, { validationPlan: null });
      setEditing(false);
      setLocalError(null);
      return;
    }
    const parsed = parseTaskValidationPlan(trimmed);
    if (!parsed.ok) {
      setLocalError(parsed.error);
      return;
    }
    onUpdate(task.id, { validationPlan: parsed.plan });
    setEditing(false);
    setLocalError(null);
  };

  return (
    <Card className="shadow-none">
      <CardContent className="flex flex-col gap-2 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Validation plan</h3>
          {!editing ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-auto px-2 py-1 text-xs" onClick={() => setEditing(true)}>
                {task.validationPlan ? 'Edit JSON' : 'Add plan'}
              </Button>
              {task.validationPlan ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => onUpdate(task.id, { validationPlan: null })}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {storedInvalid ? (
          <Alert className="border-status-needs-input/30 bg-status-needs-input/10 text-status-needs-input-foreground">
            <AlertDescription className="text-xs leading-snug">
              Stored validation plan is invalid: {storedInvalid}. Validation runs will ignore it until
              fixed.
            </AlertDescription>
          </Alert>
        ) : null}

        {editing ? (
          <>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              spellCheck={false}
              className="font-mono text-xs"
              aria-label="Validation plan JSON"
              placeholder={taskValidationPlanToJson(EXAMPLE_PLAN).trimEnd()}
            />
            {localError ? (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{localError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="bg-status-review text-status-review-foreground hover:bg-status-review/90"
                onClick={handleSave}
              >
                Save plan
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setDraft(storedJson);
                  setLocalError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : task.validationPlan && parsedStored?.ok ? (
          <PlanReadView plan={parsedStored.plan} />
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Optional structured instructions for the validator agent. Planning agents can set this with{' '}
            <code className="text-foreground">fluxx tasks update --validation-plan &apos;&#123;...&#125;&apos;</code>
            .{' '}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs text-status-review"
              onClick={() => {
                setDraft(taskValidationPlanToJson(EXAMPLE_PLAN).trimEnd());
                setEditing(true);
              }}
            >
              Start from example
            </Button>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PlanReadView({ plan }: { plan: TaskValidationPlan }) {
  return (
    <div className="flex flex-col gap-3 text-xs leading-relaxed">
      <p>
        <span className="text-muted-foreground">Goal:</span> {plan.goal}
      </p>
      <p>
        <span className="text-muted-foreground">Pack:</span> {plan.pack}
      </p>
      <PlanList title="Planned checks" items={plan.checks} />
      {plan.requiredArtifacts.length > 0 ? (
        <PlanList title="Required artifacts" items={plan.requiredArtifacts} mono />
      ) : null}
      {plan.risks?.length ? <PlanList title="Risks" items={plan.risks} /> : null}
      {plan.notes?.trim() ? (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Notes</p>
          <p className="text-muted-foreground">{plan.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

function PlanList({
  title,
  items,
  mono = false,
}: {
  title: string;
  items: string[];
  mono?: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="list-disc flex flex-col gap-1 pl-4">
        {items.map((item) => (
          <li key={item} className={mono ? 'font-mono text-[11px] text-muted-foreground' : undefined}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
