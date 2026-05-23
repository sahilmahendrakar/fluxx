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
    ...plan.checks.map((c) => `- ${c}`),
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
    '',
  );
  return lines.join('\n');
}
