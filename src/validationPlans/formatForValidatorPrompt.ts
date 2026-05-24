import type { TaskValidationPlan } from './schema';

/** Markdown section injected into the validator agent prompt when a plan is present. */
export function formatValidationPlanForValidatorPrompt(plan: TaskValidationPlan): string {
  const lines = [
    '## Validation plan',
    '',
    `**Goal:** ${plan.goal}`,
    '',
    `**Pack:** \`${plan.pack}\``,
    '',
    '### Planned checks',
    '',
    ...plan.checks.map((check, index) => `- [${index}] ${check}`),
    '',
  ];
  if (plan.requiredArtifacts.length > 0) {
    lines.push('### Required artifacts', '', ...plan.requiredArtifacts.map((a) => `- \`${a}\``), '');
  }
  if (plan.risks?.length) {
    lines.push('### Known risks / gaps', '', ...plan.risks.map((r) => `- ${r}`), '');
  }
  if (plan.notes?.trim()) {
    lines.push('### Notes', '', plan.notes.trim(), '');
  }
  lines.push(
    'Adapt these steps to the actual UI if labels or layout differ. Capture evidence for each planned check in `verdict.json` checks.',
    'Each verdict check that maps to a planned check **must** include `plannedCheckIndex` (0-based, matching the `[n]` labels above). You may emit multiple verdict checks for the same index (e.g. static + runtime).',
    'Use descriptive `name` values for humans; Fluxx aligns rows by `plannedCheckIndex`, not by name.',
    '',
  );
  return lines.join('\n');
}
