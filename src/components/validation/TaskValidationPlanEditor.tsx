import { useEffect, useMemo, useState } from 'react';
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
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-300">Validation plan</h3>
        {!editing ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] font-medium text-zinc-400 transition hover:text-zinc-200"
            >
              {task.validationPlan ? 'Edit JSON' : 'Add plan'}
            </button>
            {task.validationPlan ? (
              <button
                type="button"
                onClick={() => onUpdate(task.id, { validationPlan: null })}
                className="text-[11px] font-medium text-zinc-500 transition hover:text-red-300/90"
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {storedInvalid ? (
        <p className="mb-2 text-[11px] leading-snug text-amber-200/90" role="alert">
          Stored validation plan is invalid: {storedInvalid}. Validation runs will ignore it until
          fixed.
        </p>
      ) : null}

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            spellCheck={false}
            className="mb-2 w-full resize-y rounded-lg bg-[#0c0c0e] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-zinc-200 ring-1 ring-inset ring-white/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            aria-label="Validation plan JSON"
            placeholder={taskValidationPlanToJson(EXAMPLE_PLAN).trimEnd()}
          />
          {localError ? (
            <p className="mb-2 text-[11px] text-red-300/90" role="alert">
              {localError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-sky-500/90 px-3 py-1.5 text-[12px] font-medium text-sky-950 hover:bg-sky-400/90"
            >
              Save plan
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(storedJson);
                setLocalError(null);
              }}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-zinc-400 ring-1 ring-inset ring-white/[0.08] hover:bg-white/[0.04]"
            >
              Cancel
            </button>
          </div>
        </>
      ) : task.validationPlan && parsedStored?.ok ? (
        <PlanReadView plan={parsedStored.plan} />
      ) : (
        <p className="text-xs leading-relaxed text-zinc-500">
          Optional structured instructions for the validator agent. Planning agents can set this with{' '}
          <code className="text-zinc-400">fluxx tasks update --validation-plan &apos;&#123;...&#125;&apos;</code>
          .{' '}
          <button
            type="button"
            onClick={() => {
              setDraft(taskValidationPlanToJson(EXAMPLE_PLAN).trimEnd());
              setEditing(true);
            }}
            className="font-medium text-sky-300/90 underline decoration-sky-400/30 underline-offset-2 hover:text-sky-200"
          >
            Start from example
          </button>
        </p>
      )}
    </div>
  );
}

function PlanReadView({ plan }: { plan: TaskValidationPlan }) {
  return (
    <div className="space-y-3 text-[12px] leading-relaxed text-zinc-300">
      <p>
        <span className="text-zinc-500">Goal:</span> {plan.goal}
      </p>
      <p>
        <span className="text-zinc-500">Pack:</span> {plan.pack}
      </p>
      <PlanList title="Planned checks" items={plan.checks} />
      {plan.requiredArtifacts.length > 0 ? (
        <PlanList title="Required artifacts" items={plan.requiredArtifacts} mono />
      ) : null}
      {plan.risks?.length ? <PlanList title="Risks" items={plan.risks} /> : null}
      {plan.notes?.trim() ? (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
            Notes
          </p>
          <p className="text-zinc-400">{plan.notes}</p>
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
      <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
        {title}
      </p>
      <ul className="list-disc space-y-1 pl-4">
        {items.map((item) => (
          <li key={item} className={mono ? 'font-mono text-[11px] text-zinc-400' : undefined}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
