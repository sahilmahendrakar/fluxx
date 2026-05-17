import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { AutomationHttpServer } from './AutomationHttpServer';
import type { ActiveProjectKey } from '../types';

const activeKey: ActiveProjectKey = { kind: 'local', id: 'proj-1' };

function postInvoke(
  port: number,
  token: string,
  body: unknown,
  auth?: string,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/invoke',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...(auth !== undefined ? { authorization: auth } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, json: raw });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('AutomationHttpServer', () => {
  it('rejects missing auth token', async () => {
    const token = 'secret-token';
    const server = new AutomationHttpServer(
      token,
      () => activeKey,
      async () => ({ ok: true, data: {} }),
    );
    server.start();
    await server.whenReady();
    const port = Number(new URL(server.baseUrl).port);

    const res = await postInvoke(
      port,
      token,
      { op: 'projectInfo', expectedActiveKey: activeKey },
      'Bearer wrong',
    );
    server.stop();

    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('rejects project mismatch', async () => {
    const token = 'secret-token';
    const server = new AutomationHttpServer(
      token,
      () => activeKey,
      async () => ({ ok: true, data: {} }),
    );
    server.start();
    await server.whenReady();
    const port = Number(new URL(server.baseUrl).port);

    const res = await postInvoke(port, token, {
      op: 'projectInfo',
      expectedActiveKey: { kind: 'local', id: 'other' },
    }, `Bearer ${token}`);
    server.stop();

    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ ok: false, code: 'PROJECT_KIND_MISMATCH' });
  });

  it('invokes handler on success', async () => {
    const token = 'secret-token';
    const server = new AutomationHttpServer(
      token,
      () => activeKey,
      async (body) => ({ ok: true, data: { op: body.op } }),
    );
    server.start();
    await server.whenReady();
    const port = Number(new URL(server.baseUrl).port);

    const res = await postInvoke(
      port,
      token,
      { op: 'projectInfo', expectedActiveKey: activeKey },
      `Bearer ${token}`,
    );
    server.stop();

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, data: { op: 'projectInfo' } });
  });
});
