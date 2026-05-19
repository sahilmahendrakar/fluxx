import type { TaskHandoffOutcome } from './types';

/** Outcomes exposed in worker-facing prompts and validation. */
export const HANDOFF_OUTCOMES_FOR_PROMPT: TaskHandoffOutcome[] = [
  'complete',
  'blocked',
  'partial',
];
