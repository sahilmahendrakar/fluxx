import { ipcMain, type BrowserWindow } from 'electron';
import {
  AUTOMATION_BRIDGE_READY_CHANNEL,
  AUTOMATION_BRIDGE_REQUEST_CHANNEL,
  AUTOMATION_BRIDGE_RESPONSE_CHANNEL,
  type AutomationBridgeErrorCode,
  type AutomationBridgeOp,
  type AutomationBridgeRequest,
  type AutomationBridgeResponse,
} from '../rendererAutomationBridge';
import type { ActiveProjectKey } from '../types';

const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_READY_TIMEOUT_MS = 5000;

export type AutomationBridgeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: AutomationBridgeErrorCode; message: string };

interface PendingRequest {
  resolve: (resp: AutomationBridgeResponse) => void;
  timer: NodeJS.Timeout;
}

/**
 * Main-side request/response bridge to the renderer for cloud-project automation
 * (CLI and other automation callers). The renderer holds Firebase auth and the active
 * TaskProvider, so Firestore reads/writes for cloud projects go through this RPC.
 * Local projects do not use the bridge.
 */
export class RendererAutomationBridge {
  private getMainWindow: () => BrowserWindow | null;
  private rendererReady = false;
  private readyWaiters: Array<() => void> = [];
  private pending = new Map<string, PendingRequest>();
  private nextId = 0;
  private installed = false;
  private attachedWebContentsIds = new Set<number>();

  constructor(getMainWindow: () => BrowserWindow | null) {
    this.getMainWindow = getMainWindow;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;
    ipcMain.on(AUTOMATION_BRIDGE_RESPONSE_CHANNEL, (_e, resp: AutomationBridgeResponse) => {
      const pending = this.pending.get(resp.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(resp.id);
      pending.resolve(resp);
    });
    ipcMain.on(AUTOMATION_BRIDGE_READY_CHANNEL, () => {
      this.markReady();
    });
  }

  /**
   * Attach crash + close listeners to a window's webContents so in-flight
   * requests fail immediately rather than timing out when the renderer
   * disappears. Idempotent per-webContents.
   */
  attachWindow(window: BrowserWindow): void {
    const wcId = window.webContents.id;
    if (this.attachedWebContentsIds.has(wcId)) return;
    this.attachedWebContentsIds.add(wcId);

    window.webContents.on('render-process-gone', (_e, details) => {
      this.failAllPending(
        'RENDERER_NOT_READY',
        `Renderer process gone (${details.reason})`,
      );
    });
    window.on('closed', () => {
      this.attachedWebContentsIds.delete(wcId);
      this.failAllPending('RENDERER_NOT_READY', 'Renderer window closed');
    });
  }

  private failAllPending(
    code: AutomationBridgeErrorCode,
    message: string,
  ): void {
    this.rendererReady = false;
    const ids = Array.from(this.pending.keys());
    for (const id of ids) {
      const p = this.pending.get(id);
      if (!p) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.resolve({ id, ok: false, code, message });
    }
  }

  /** Renderer reload/navigate clears readiness; next signalReady flips it back. */
  markNotReady(): void {
    this.rendererReady = false;
  }

  isReady(): boolean {
    return this.rendererReady;
  }

  private markReady(): void {
    this.rendererReady = true;
    const waiters = this.readyWaiters.splice(0);
    for (const w of waiters) w();
  }

  private waitUntilReady(timeoutMs: number): Promise<boolean> {
    if (this.rendererReady) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const onReady = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const ix = this.readyWaiters.indexOf(onReady);
        if (ix !== -1) this.readyWaiters.splice(ix, 1);
        resolve(false);
      }, timeoutMs);
      this.readyWaiters.push(onReady);
    });
  }

  async request<T = unknown>(
    op: AutomationBridgeOp,
    expectedActiveKey: ActiveProjectKey,
    payload?: unknown,
    options?: { timeoutMs?: number; readyTimeoutMs?: number },
  ): Promise<AutomationBridgeResult<T>> {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) {
      return {
        ok: false,
        code: 'RENDERER_NOT_READY',
        message: 'No main window available',
      };
    }

    const ready = await this.waitUntilReady(
      options?.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
    );
    if (!ready) {
      return {
        ok: false,
        code: 'RENDERER_NOT_READY',
        message: 'Renderer did not signal ready in time',
      };
    }

    const id = `automation-bridge-${Date.now()}-${++this.nextId}`;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    const envelope = await new Promise<AutomationBridgeResponse>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({
            id,
            ok: false,
            code: 'RENDERER_TIMEOUT',
            message: `No response from renderer within ${timeoutMs}ms`,
          });
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });

      const req: AutomationBridgeRequest = { id, op, expectedActiveKey, payload };
      try {
        win.webContents.send(AUTOMATION_BRIDGE_REQUEST_CHANNEL, req);
      } catch (err) {
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(id);
        }
        resolve({
          id,
          ok: false,
          code: 'INTERNAL',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    if (envelope.ok) {
      return { ok: true, data: envelope.data as T };
    }
    return { ok: false, code: envelope.code, message: envelope.message };
  }
}
