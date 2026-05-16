import { DaemonClient } from '../DaemonClient';
import { deliverTerminalStreamFrameToRenderers } from '../TerminalRuntimeManager';
import { DetachedRpcTerminalBackend } from './DetachedRpcTerminalBackend';
import { LocalMainProcessTerminalBackend } from './LocalMainProcessTerminalBackend';
import type { TerminalBackend } from './TerminalBackend';

/**
 * Selects the terminal backend for `main.ts`.
 *
 * - `detached` (default): legacy child process + sockets via {@link DetachedRpcTerminalBackend}.
 * - `local`: Electron main-process PTYs via {@link LocalMainProcessTerminalBackend}.
 *
 * A future `remote` value could construct a backend that speaks to a cloud runner over
 * WebSocket while preserving the same {@link TerminalBackend} surface.
 */
export function createMainTerminalBackend(): TerminalBackend {
  const mode = (process.env.FLUX_TERMINAL_BACKEND ?? 'detached').trim().toLowerCase();
  if (mode === 'detached' || mode === 'legacy') {
    return new DetachedRpcTerminalBackend(new DaemonClient());
  }
  return new LocalMainProcessTerminalBackend({
    deliverStreamFrame: deliverTerminalStreamFrameToRenderers,
  });
}
