import type { Task } from '../types';
import type { ValidationRun } from './types';
import { evaluateManualValidationEligibility } from './display';

export type ValidateActionEligibility = {
  canValidate: boolean;
  message?: string;
};

/** Eligibility for the Validate affordance (In progress / Needs input → Validation). */
export function evaluateValidateActionEligibility(input: {
  validationEnabled: boolean;
  task: Pick<Task, 'status' | 'agent'>;
  latestRun: ValidationRun | null;
  repoBlocked?: boolean;
}): ValidateActionEligibility {
  if (!input.validationEnabled) {
    return { canValidate: false };
  }
  if (input.repoBlocked) {
    return {
      canValidate: false,
      message: 'Fix repository setup before running validation.',
    };
  }
  if (input.task.status !== 'in-progress' && input.task.status !== 'needs-input') {
    return { canValidate: false };
  }
  if (input.task.agent == null) {
    return {
      canValidate: false,
      message: 'Choose an agent for this task before validating.',
    };
  }
  const manual = evaluateManualValidationEligibility({
    task: { status: 'validation', agent: input.task.agent },
    latestRun: input.latestRun,
  });
  if (manual.reason === 'already-running') {
    return { canValidate: false, message: manual.message };
  }
  return { canValidate: true };
}
