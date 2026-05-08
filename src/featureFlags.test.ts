import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FEATURE_FLAGS,
  isFeatureFlagEnabled,
  isMultiRepo2Enabled,
} from './featureFlags';

describe('featureFlags', () => {
  const ORIGINAL = process.env.FLUX_FF_MULTI_REPO2;

  beforeEach(() => {
    delete process.env.FLUX_FF_MULTI_REPO2;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.FLUX_FF_MULTI_REPO2;
    } else {
      process.env.FLUX_FF_MULTI_REPO2 = ORIGINAL;
    }
  });

  it('exposes the documented `multi-repo2` flag name', () => {
    expect(FEATURE_FLAGS.multiRepo2).toBe('multi-repo2');
  });

  it('isMultiRepo2Enabled defaults to false (preserves single-repo UX)', () => {
    expect(isMultiRepo2Enabled()).toBe(false);
  });

  it('accepts truthy variants', () => {
    for (const v of ['1', 'true', 'YES', 'on']) {
      process.env.FLUX_FF_MULTI_REPO2 = v;
      expect(isMultiRepo2Enabled()).toBe(true);
      expect(isFeatureFlagEnabled('multi-repo2')).toBe(true);
    }
  });

  it('treats falsy / unrecognised values as disabled', () => {
    for (const v of ['', '0', 'no', 'off', 'whatever']) {
      process.env.FLUX_FF_MULTI_REPO2 = v;
      expect(isMultiRepo2Enabled()).toBe(false);
    }
  });
});
