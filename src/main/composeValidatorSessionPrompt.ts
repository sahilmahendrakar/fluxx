import type { Task, TaskValidationPlan } from '../types';
import type { ValidationRun } from '../validationRuns/types';
import { formatValidationPlanForValidatorPrompt } from '../validationPlans/formatForValidatorPrompt';

export type ValidatorSessionPromptInput = {
  task: Task;
  run: Pick<ValidationRun, 'id' | 'artifactDir' | 'packId' | 'validatorAgent'>;
  worktreeCwd: string;
  instructionsMarkdown: string;
  verdictSchemaJson: string;
  changeSummary?: string;
  planJsonPath?: string;
  validationPlan?: TaskValidationPlan;
  validationPlanWarning?: string;
};

const VALIDATOR_RULES = [
  'You are an independent **validator** agent. Do **not** implement product source changes unless explicitly required to run validation scripts under the validation run directory.',
  'Test **task-specific behavior** described in the task — avoid generic smoke tests that ignore acceptance criteria.',
  'Write all evidence (screenshots, traces, videos, logs, scripts) under the validation run directory — never into the source repo.',
  'Write `verdict.json` at the run root before finishing. Follow the verdict schema exactly.',
  'After writing `verdict.json`, run `fluxx validation finish --run-id "$FLUXX_VALIDATION_RUN_ID" --json` (or `$FLUXX_VALIDATION_FINISH_COMMAND`) to register artifacts and update run status.',
  'Do **not** exit the terminal to finish validation — stay available for user follow-up after the finish command succeeds.',
  'Document validation gaps honestly in `risks` instead of overstating confidence.',
  'Prefer role/text/test-id locators over brittle CSS selectors.',
  'Close Electron / Playwright apps in `finally` blocks.',
];

function extractAcceptanceCriteria(description: string): string | null {
  const text = description.trim();
  if (!text) return null;
  const match = text.match(
    /(?:^|\n)##\s*Acceptance Criteria\s*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i,
  );
  if (!match) return null;
  const body = match[1].trim();
  return body.length > 0 ? body : null;
}

function formatTaskSection(task: Task): string {
  const desc = (task.description ?? '').trim();
  const acceptance = extractAcceptanceCriteria(desc);
  const lines = [
    '## Task under validation',
    '',
    `- **Task id:** \`${task.id}\``,
    `- **Title:** ${task.title.trim() || '(untitled)'}`,
    '',
  ];
  if (acceptance) {
    lines.push('### Acceptance criteria', '', acceptance, '');
    const withoutAcceptance = desc.replace(
      /(?:^|\n)##\s*Acceptance Criteria\s*\n[\s\S]*?(?=\n##\s|\n#\s|$)/i,
      '',
    ).trim();
    if (withoutAcceptance) {
      lines.push('### Description', '', withoutAcceptance, '');
    }
  } else if (desc) {
    lines.push('### Description', '', desc, '');
  }
  return lines.join('\n');
}

function formatArtifactContract(run: Pick<ValidationRun, 'id' | 'artifactDir'>): string {
  const runDir = run.artifactDir;
  return [
    '## Validation run directory',
    '',
    `- **Run id:** \`${run.id}\``,
    `- **Absolute path:** \`${runDir}\``,
    '',
    'Required layout (write under this directory only):',
    '',
    '```text',
    `${runDir}/`,
    '  instructions.md           pack instructions (reference)',
    '  validate-electron.mjs     starter script (optional base)',
    '  plan.json                 optional validation plan',
    '  verdict.json              required final verdict',
    '  artifacts/',
    '    screenshots/',
    '    traces/',
    '    videos/',
    '    logs/',
    '    data/',
    '```',
    '',
    'If Playwright must run from the task worktree for module resolution, still write screenshots, traces, videos, logs, and `verdict.json` back to the validation run directory above.',
  ].join('\n');
}

/**
 * First prompt for a validator agent session: task context, change summary, pack
 * instructions, artifact contract, and explicit non-implementation rules.
 */
export function composeValidatorSessionPrompt(input: ValidatorSessionPromptInput): string {
  const {
    task,
    run,
    worktreeCwd,
    instructionsMarkdown,
    verdictSchemaJson,
    changeSummary,
    planJsonPath,
    validationPlan,
    validationPlanWarning,
  } = input;

  const parts = [
    '# Fluxx validation run',
    '',
    `Validate the implementation for task \`${task.id}\` using the **${run.packId}** pack.`,
    '',
    formatTaskSection(task),
    '## Validator rules',
    '',
    ...VALIDATOR_RULES.map((r) => `- ${r}`),
    '',
    '## Worktree',
    '',
    `- **cwd:** \`${worktreeCwd}\``,
    `- **Validator agent:** ${run.validatorAgent}`,
    '',
    '**Prerequisites in the task worktree:** `pnpm install` (Playwright is a root devDependency — do not install it under the validation run directory), then `pnpm run build:validation` so `.vite/build/main.js` exists before `electron.launch`.',
    '',
  ];

  if (changeSummary?.trim()) {
    parts.push('## Repository change summary', '', changeSummary.trim(), '');
  }

  if (validationPlanWarning?.trim()) {
    parts.push(
      '## Validation plan warning',
      '',
      validationPlanWarning.trim(),
      '',
    );
  }

  if (validationPlan) {
    parts.push(formatValidationPlanForValidatorPrompt(validationPlan));
  } else if (planJsonPath?.trim()) {
    parts.push(
      '## Validation plan',
      '',
      `Optional plan at \`${planJsonPath.trim()}\` — read when present and adapt if the UI differs.`,
      '',
    );
  }

  parts.push(formatArtifactContract(run));
  parts.push(
    '## Finish validation',
    '',
    'When all evidence is written and `verdict.json` is complete, finalize the run:',
    '',
    '```bash',
    'fluxx validation finish --run-id "$FLUXX_VALIDATION_RUN_ID" --json',
    '```',
    '',
    'Or run the preconfigured command:',
    '',
    '```bash',
    '$FLUXX_VALIDATION_FINISH_COMMAND',
    '```',
    '',
    'Keep the validator session open after finish succeeds so the user can ask follow-up questions.',
    '',
    '## Verdict contract',
    '',
    'Write `verdict.json` at the run root with this schema:',
    '',
    '```json',
    verdictSchemaJson.trim(),
    '```',
    '',
    '## Pack instructions',
    '',
    instructionsMarkdown.trim(),
    '',
  );

  return parts.join('\n');
}
