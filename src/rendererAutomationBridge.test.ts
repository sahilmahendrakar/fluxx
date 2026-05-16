import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_BRIDGE_READY_CHANNEL,
  AUTOMATION_BRIDGE_REQUEST_CHANNEL,
  AUTOMATION_BRIDGE_RESPONSE_CHANNEL,
  automationBridgeErrorResponse,
  isAutomationBridgeResponse,
  type AutomationBridgeRequest,
} from './rendererAutomationBridge';

describe('rendererAutomationBridge IPC channels', () => {
  it('uses automation-prefixed channel names', () => {
    expect(AUTOMATION_BRIDGE_REQUEST_CHANNEL).toBe('automation:rendererBridge:request');
    expect(AUTOMATION_BRIDGE_RESPONSE_CHANNEL).toBe('automation:rendererBridge:response');
    expect(AUTOMATION_BRIDGE_READY_CHANNEL).toBe('automation:rendererBridge:ready');
    expect(AUTOMATION_BRIDGE_REQUEST_CHANNEL).not.toContain('mcp:');
  });
});

describe('automation bridge envelopes', () => {
  const request: AutomationBridgeRequest = {
    id: 'automation-bridge-1',
    op: 'tasks.list',
    expectedActiveKey: { kind: 'cloud', id: 'proj-1' },
  };

  it('accepts success and error response shapes', () => {
    expect(isAutomationBridgeResponse({ id: request.id, ok: true, data: [] })).toBe(true);
    expect(
      isAutomationBridgeResponse(
        automationBridgeErrorResponse(request.id, 'AUTH_NOT_READY', 'Sign in to Flux'),
      ),
    ).toBe(true);
    expect(isAutomationBridgeResponse({ id: request.id, ok: false })).toBe(false);
    expect(isAutomationBridgeResponse(null)).toBe(false);
  });

  it('builds error responses with code and message', () => {
    const resp = automationBridgeErrorResponse(
      request.id,
      'PROJECT_KIND_MISMATCH',
      'Active project changed',
    );
    expect(resp).toEqual({
      id: request.id,
      ok: false,
      code: 'PROJECT_KIND_MISMATCH',
      message: 'Active project changed',
    });
  });
});
