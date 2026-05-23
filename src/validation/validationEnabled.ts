import type { FluxAutomationInvokeResponse } from '../main/AutomationHttpServer';

export const VALIDATION_DISABLED_CODE = 'VALIDATION_DISABLED' as const;

export const VALIDATION_DISABLED_MESSAGE =
  'Validation is disabled for this project. Turn it on in Project settings → Experimental.';

/** Missing or non-true values normalize to off (opt-in). */
export function normalizeValidationEnabled(value: unknown): boolean {
  return value === true;
}

export function isValidationEnabledForProject(
  project: { validationEnabled?: unknown } | null | undefined,
): boolean {
  return normalizeValidationEnabled(project?.validationEnabled);
}

export type ValidationDisabledJson = {
  error: typeof VALIDATION_DISABLED_CODE;
  message: string;
};

export function validationDisabledJson(): ValidationDisabledJson {
  return { error: VALIDATION_DISABLED_CODE, message: VALIDATION_DISABLED_MESSAGE };
}

export function validationDisabledInvokeResponse(): FluxAutomationInvokeResponse {
  return {
    ok: false,
    error: VALIDATION_DISABLED_MESSAGE,
    code: VALIDATION_DISABLED_CODE,
  };
}
