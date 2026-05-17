import { describe, expect, it } from 'vitest';
import {
  automationBridgeFailureMessage,
  automationBridgeFailureToInvoke,
} from './automationBridgeFailureMessage';

describe('automationBridgeFailureMessage', () => {
  it('maps renderer and auth errors to user-facing strings', () => {
    expect(
      automationBridgeFailureMessage({
        code: 'AUTH_NOT_READY',
        message: 'TaskProvider not ready',
      }),
    ).toBe('Sign in to Flux to use cloud project tools');
    expect(
      automationBridgeFailureMessage({
        code: 'RENDERER_NOT_READY',
        message: 'No main window available',
      }),
    ).toBe('Open the Flux app to enable cloud project tools');
    expect(
      automationBridgeFailureMessage({
        code: 'RENDERER_TIMEOUT',
        message: 'No response from renderer within 8000ms',
      }),
    ).toBe('Flux app did not respond in time. Please try again.');
    expect(
      automationBridgeFailureMessage({
        code: 'PROJECT_KIND_MISMATCH',
        message: 'Expected cloud/x, renderer has cloud/y',
      }),
    ).toBe('Active project changed during request. Please retry.');
  });

  it('passes through provider and internal messages', () => {
    expect(
      automationBridgeFailureMessage({
        code: 'PROVIDER_ERROR',
        message: 'Firestore permission denied',
      }),
    ).toBe('Firestore permission denied');
  });
});

describe('automationBridgeFailureToInvoke', () => {
  it('returns invoke envelope with friendly error and code', () => {
    expect(
      automationBridgeFailureToInvoke({
        ok: false,
        code: 'NO_ACTIVE_PROJECT',
        message: 'No active project in renderer',
      }),
    ).toEqual({
      ok: false,
      error: 'No project open',
      code: 'NO_ACTIVE_PROJECT',
    });
  });
});
