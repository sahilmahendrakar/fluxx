import type { AutomationBridgeErrorCode } from '../rendererAutomationBridge';
import type { AutomationBridgeResult } from './RendererAutomationBridge';
import type { FluxAutomationInvokeResponse } from './AutomationHttpServer';

export function automationBridgeFailureMessage(result: {
  code: AutomationBridgeErrorCode;
  message: string;
}): string {
  switch (result.code) {
    case 'AUTH_NOT_READY':
      return 'Sign in to Flux to use cloud project tools';
    case 'RENDERER_NOT_READY':
      return 'Open the Flux app to enable cloud project tools';
    case 'RENDERER_TIMEOUT':
      return 'Flux app did not respond in time. Please try again.';
    case 'PROJECT_KIND_MISMATCH':
      return 'Active project changed during request. Please retry.';
    case 'NO_ACTIVE_PROJECT':
      return 'No project open';
    default:
      return result.message;
  }
}

export function automationBridgeFailureToInvoke(
  result: Extract<AutomationBridgeResult<unknown>, { ok: false }>,
): FluxAutomationInvokeResponse {
  return {
    ok: false,
    error: automationBridgeFailureMessage(result),
    code: result.code,
  };
}
