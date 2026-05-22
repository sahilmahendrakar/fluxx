import {
  deliverTerminalStreamFrameToRenderers,
  type TerminalRuntimeManagerOptions,
} from '../TerminalRuntimeManager';
import { LocalMainProcessTerminalBackend } from './LocalMainProcessTerminalBackend';
import type { TerminalBackend } from './TerminalBackend';

/**
 * Terminal backend for `main.ts`: Electron main-process PTYs via
 * {@link LocalMainProcessTerminalBackend}.
 */
export function createMainTerminalBackend(
  opts: TerminalRuntimeManagerOptions = {},
): TerminalBackend {
  return new LocalMainProcessTerminalBackend({
    deliverStreamFrame: deliverTerminalStreamFrameToRenderers,
    ...opts,
  });
}
