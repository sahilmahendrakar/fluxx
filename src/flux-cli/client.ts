import type { FluxAutomationHttpOp, FluxAutomationInvokeResponse } from '../main/AutomationHttpServer';
import type { FluxCliBridgeConfig } from './config';

export class FluxCliConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FluxCliConnectionError';
  }
}

export async function invokeFluxAutomation(
  config: FluxCliBridgeConfig,
  op: FluxAutomationHttpOp,
  payload?: unknown,
): Promise<FluxAutomationInvokeResponse> {
  let res: Response;
  try {
    res = await fetch(`${config.url.replace(/\/$/, '')}/v1/invoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        op,
        expectedActiveKey: config.expectedActiveKey,
        ...(payload !== undefined ? { payload } : {}),
      }),
    });
  } catch {
    throw new FluxCliConnectionError(
      'Could not reach Flux. Is the Flux app running with this project open?',
    );
  }

  let body: FluxAutomationInvokeResponse;
  try {
    body = (await res.json()) as FluxAutomationInvokeResponse;
  } catch {
    throw new FluxCliConnectionError('Flux returned a non-JSON response');
  }

  if (res.status === 401) {
    return { ok: false, error: body.ok === false ? body.error : 'Unauthorized', code: 'UNAUTHORIZED' };
  }
  if (res.status === 409 && body.ok === false) {
    return body;
  }
  if (!res.ok && body.ok === false) {
    return body;
  }
  if (!body || typeof body !== 'object' || !('ok' in body)) {
    return { ok: false, error: `Unexpected Flux response (HTTP ${res.status})` };
  }
  return body;
}
