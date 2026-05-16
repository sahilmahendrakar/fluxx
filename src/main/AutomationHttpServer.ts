import http from 'node:http';
import type { ActiveProjectKey } from '../types';
import type { McpBridgeErrorCode, McpBridgeOp } from '../mcpBridge';
import { activeProjectKeysEqual } from './activeProjectKey';

export type FluxAutomationHttpOp = McpBridgeOp | 'tasks.start';

export interface FluxAutomationInvokeBody {
  op: FluxAutomationHttpOp;
  expectedActiveKey: ActiveProjectKey;
  payload?: unknown;
}

export type FluxAutomationInvokeResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code?: McpBridgeErrorCode | 'NO_ACTIVE_PROJECT' | 'UNAUTHORIZED' };

function readJsonBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Loopback HTTP endpoint for the `flux` CLI. One listener per app instance on
 * an ephemeral port; guarded by a random bearer token.
 */
export class AutomationHttpServer {
  private server: http.Server | null = null;
  private port: number | null = null;
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly token: string,
    private readonly getActiveProjectKey: () => ActiveProjectKey | null | undefined,
    private readonly invokeAutomation: (body: FluxAutomationInvokeBody) => Promise<FluxAutomationInvokeResponse>,
  ) {}

  get baseUrl(): string {
    if (this.port == null) {
      throw new Error('[automation] server not listening');
    }
    return `http://127.0.0.1:${this.port}`;
  }

  whenReady(): Promise<void> {
    if (this.port != null) {
      return Promise.resolve();
    }
    if (!this.readyPromise) {
      return Promise.reject(new Error('[automation] server not started'));
    }
    return this.readyPromise;
  }

  start(): void {
    if (this.server) return;

    this.readyPromise = new Promise((resolve, reject) => {
      const httpServer = http.createServer((req, res) => {
      void this.handle(req, res).catch((err) => {
        console.error('[automation] request error', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' }).end(
            JSON.stringify({ ok: false, error: 'Internal automation error' }),
          );
        }
      });
      });

      httpServer.once('listening', () => {
        const addr = httpServer.address();
        this.server = httpServer;
        this.port = typeof addr === 'object' && addr && 'port' in addr ? addr.port : null;
        if (this.port != null) {
          console.log(`[automation] listening on http://127.0.0.1:${this.port}`);
        }
        resolve();
      });

      httpServer.on('error', (err) => {
        console.error('[automation] HTTP server error', err);
        reject(err);
      });

      httpServer.listen(0, '127.0.0.1');
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = null;
      this.readyPromise = null;
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== '/v1/invoke') {
      res.writeHead(404).end();
      return;
    }

    const auth = req.headers.authorization?.trim() ?? '';
    const expected = `Bearer ${this.token}`;
    if (auth !== expected) {
      res
        .writeHead(401, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: false, error: 'Invalid or missing automation token', code: 'UNAUTHORIZED' }));
      return;
    }

    let raw: string;
    try {
      raw = await readJsonBody(req);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({ ok: false, error: 'Could not read request body' }),
      );
      return;
    }

    let body: FluxAutomationInvokeBody;
    try {
      body = JSON.parse(raw) as FluxAutomationInvokeBody;
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({ ok: false, error: 'Invalid JSON body' }),
      );
      return;
    }

    if (
      !body ||
      typeof body !== 'object' ||
      typeof body.op !== 'string' ||
      !body.expectedActiveKey ||
      typeof body.expectedActiveKey !== 'object' ||
      typeof body.expectedActiveKey.kind !== 'string' ||
      typeof body.expectedActiveKey.id !== 'string'
    ) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({ ok: false, error: 'Missing op or expectedActiveKey' }),
      );
      return;
    }

    const current = this.getActiveProjectKey();
    if (!current) {
      res.writeHead(409, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          ok: false,
          error: 'No project open in Flux',
          code: 'NO_ACTIVE_PROJECT',
        }),
      );
      return;
    }

    if (!activeProjectKeysEqual(current, body.expectedActiveKey)) {
      res.writeHead(409, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          ok: false,
          error: 'Active project does not match this planning shell',
          code: 'PROJECT_KIND_MISMATCH',
        }),
      );
      return;
    }

    const result = await this.invokeAutomation(body);
    const status = result.ok ? 200 : 400;
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  }
}
