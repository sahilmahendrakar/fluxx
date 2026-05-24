import { describe, expect, it } from 'vitest';
import {
  VALIDATION_DISABLED_CODE,
  VALIDATION_DISABLED_MESSAGE,
  normalizeValidationEnabled,
  validationDisabledInvokeResponse,
  validationDisabledJson,
} from './validationEnabled';

describe('validationEnabled', () => {
  it('normalizes missing values to false', () => {
    expect(normalizeValidationEnabled(undefined)).toBe(false);
    expect(normalizeValidationEnabled(false)).toBe(false);
    expect(normalizeValidationEnabled(true)).toBe(true);
  });

  it('exposes stable disabled JSON for CLI', () => {
    expect(validationDisabledJson()).toEqual({
      error: VALIDATION_DISABLED_CODE,
      message: VALIDATION_DISABLED_MESSAGE,
    });
    const invoke = validationDisabledInvokeResponse();
    expect(invoke.ok).toBe(false);
    if (!invoke.ok) {
      expect(invoke.code).toBe(VALIDATION_DISABLED_CODE);
      expect(invoke.error).toBe(VALIDATION_DISABLED_MESSAGE);
    }
  });
});
