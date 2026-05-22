import type { TerminalSessionRecord } from '../types';
import type { TerminalBackend } from './terminalBackend/TerminalBackend';

/** Merge durable inventory runtime fields from the live terminal backend. */
export function withTerminalRuntimeMeta(
  backend: TerminalBackend,
  terminalId: string,
  kind: 'session' | 'shell' | 'planning',
  row: TerminalSessionRecord,
): TerminalSessionRecord {
  const meta = backend.getTerminalRuntimeMeta?.(terminalId, kind);
  if (!meta) return row;
  return {
    ...row,
    runtime: meta.runtime,
    ...(meta.tmuxSessionName ? { tmuxSessionName: meta.tmuxSessionName } : {}),
  };
}
