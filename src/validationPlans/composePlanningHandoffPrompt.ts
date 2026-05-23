import type { TaskValidationPlan } from './schema';
import { taskValidationPlanToJson } from './schema';

export type ValidationPlanPlanningContext = {
  taskTitle: string;
  implementationDescription?: string;
  acceptanceCriteria?: string;
  changeSummary?: string;
  changedFiles?: string[];
  planningDocExcerpts?: string[];
};

/**
 * Prompt section for planning agents generating a task-specific validation plan
 * before the validator runs.
 */
export function composeValidationPlanHandoffPrompt(ctx: ValidationPlanPlanningContext): string {
  const example: TaskValidationPlan = {
    goal: 'Verify the requested UI behavior and capture evidence',
    pack: 'electron-playwright',
    checks: [
      'Launch the app with isolated user data',
      'Exercise the task-specific UI flow',
      'Capture screenshots at each milestone',
    ],
    requiredArtifacts: ['primary-flow-screenshot'],
    risks: ['Did not verify production packaging behavior.'],
  };

  const parts = [
    '## Optional validation plan handoff',
    '',
    'When a task is ready for Review and validation would benefit from task-specific guidance,',
    'produce a concise validation plan for the **validator agent** (not the implementation description).',
    'Persist it with `fluxx tasks update --json --id <taskId> --validation-plan \'<json>\'`.',
  ];

  if (ctx.taskTitle.trim()) {
    parts.push('', `**Task title:** ${ctx.taskTitle.trim()}`);
  }
  if (ctx.implementationDescription?.trim()) {
    parts.push('', '### Implementation description', '', ctx.implementationDescription.trim());
  }
  if (ctx.acceptanceCriteria?.trim()) {
    parts.push('', '### Acceptance criteria', '', ctx.acceptanceCriteria.trim());
  }
  if (ctx.changeSummary?.trim()) {
    parts.push('', '### Change summary', '', ctx.changeSummary.trim());
  }
  if (ctx.changedFiles?.length) {
    parts.push('', '### Changed files', '', ...ctx.changedFiles.map((f) => `- \`${f}\``));
  }
  if (ctx.planningDocExcerpts?.length) {
    parts.push('', '### Planning context', '', ...ctx.planningDocExcerpts);
  }

  parts.push(
    '',
    '### Plan JSON shape',
    '',
    'Required fields: `goal`, `pack` (`electron-playwright`), `checks` (non-empty strings), `requiredArtifacts` (strings).',
    'Optional: `risks`, `notes`.',
    '',
    'Example:',
    '',
    '```json',
    taskValidationPlanToJson(example).trimEnd(),
    '```',
    '',
    'Keep checks executable by another agent. Do not embed the plan inside `--description`.',
  );

  return parts.join('\n');
}
