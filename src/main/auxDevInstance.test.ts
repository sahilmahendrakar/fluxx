import { afterEach, describe, expect, it } from 'vitest';
import { isAuxDevInstance, shouldRequestSingleInstanceLock } from './auxDevInstance';

describe('isAuxDevInstance', () => {
  const prior = { ...process.env };

  afterEach(() => {
    process.env = { ...prior };
  });

  it('returns false when FLUX_AUX_DEV_SERVER_PORT is unset', () => {
    delete process.env.FLUX_AUX_DEV_SERVER_PORT;
    expect(isAuxDevInstance()).toBe(false);
  });

  it('returns true for a valid aux dev port', () => {
    process.env.FLUX_AUX_DEV_SERVER_PORT = '5180';
    expect(isAuxDevInstance()).toBe(true);
  });

  it('returns false for invalid port values', () => {
    process.env.FLUX_AUX_DEV_SERVER_PORT = 'not-a-port';
    expect(isAuxDevInstance()).toBe(false);
  });

  it('shouldRequestSingleInstanceLock is false for aux dev', () => {
    process.env.FLUX_AUX_DEV_SERVER_PORT = '5180';
    expect(shouldRequestSingleInstanceLock()).toBe(false);
  });

  it('shouldRequestSingleInstanceLock is true for primary dev', () => {
    delete process.env.FLUX_AUX_DEV_SERVER_PORT;
    expect(shouldRequestSingleInstanceLock()).toBe(true);
  });
});
