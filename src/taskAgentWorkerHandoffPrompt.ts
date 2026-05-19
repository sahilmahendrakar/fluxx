import {
  HANDOFF_OUTCOMES_FOR_PROMPT,
  type TaskHandoffOutcome,
} from './taskAgentHandoffContract';

/** Relative path (from task worktree root) where the worker writes handoff JSON for the stop hook. */
export const FLUXX_WORKER_HANDOFF_JSON_REL = '.cursor/.fluxx-worker-handoff.json';

export type TaskAgentWorkerHandoffPromptParams = {
  taskId: string;
};

/**
 * Instructions for Cursor task agents: write structured handoff JSON before finishing.
 * Flux's stop hook submits it via `fluxx coordination submit-handoff`; manual CLI is the fallback.
 */
export function buildTaskAgentWorkerHandoffInstructions(
  p: TaskAgentWorkerHandoffPromptParams,
): string {
  const outcomes = HANDOFF_OUTCOMES_FOR_PROMPT.join(' | ');
  return [
    '## Fluxx: worker completion handoff',
    '',
    'When you believe this task is complete (or blocked/partial), submit a structured handoff for overseer review.',
    '',
    '### Preferred (hook-driven)',
    `1. Write a JSON object to \`${FLUXX_WORKER_HANDOFF_JSON_REL}\` in this worktree (create \`.cursor/\` if needed).`,
    '2. Use this shape (all string arrays are optional except where noted):',
    '```json',
    JSON.stringify(
      {
        outcome: 'complete' as TaskHandoffOutcome,
        summary: 'What you did and how to verify it.',
        filesChanged: ['path/to/file.ts'],
        checks: [{ name: 'unit tests', status: 'passed', detail: 'optional' }],
        blockers: ['only when outcome is blocked'],
        reviewNotes: 'optional notes for the overseer',
      },
      null,
      2,
    ),
    '```',
    `   - \`outcome\`: one of ${outcomes}`,
    '   - `summary`: required, non-empty',
    '   - Do **not** commit `.cursor/.fluxx-worker-handoff.json` or other Fluxx hook files.',
    '3. Finish the session normally. A Cursor **stop** hook will submit the handoff to Fluxx.',
    '',
    '### Manual fallback (if hooks are unavailable)',
    `Run from this worktree (requires \`fluxx\` on PATH from a Fluxx-started session):`,
    '```bash',
    `fluxx coordination submit-handoff --json --task-id ${p.taskId} --handoff-json "$(cat ${FLUXX_WORKER_HANDOFF_JSON_REL})"`,
    '```',
    '',
    'If submission fails, fix the JSON and retry the command; do not merge to the feature branch until the overseer approves.',
  ].join('\n');
}
