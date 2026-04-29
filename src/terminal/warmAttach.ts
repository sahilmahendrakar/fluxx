import type { AttachResult } from '../daemon/protocol';
import type { TerminalHandle } from '../components/Terminal';

/**
 * IPC attach result caches. Module-scoped so React 18 dev StrictMode
 * remounts do not issue duplicate `attach` RPCs when a logical consumer
 * mounts again before the in-flight call resolves.
 */
export const sessionAttachCache = new Map<string, AttachResult>();
export const shellAttachCache = new Map<string, AttachResult>();
export const planningAttachCache = new Map<string, AttachResult>();

export function invalidateSessionAttachCache(id: string): void {
  sessionAttachCache.delete(id);
}

export function invalidateShellAttachCache(id: string): void {
  shellAttachCache.delete(id);
}

export function invalidatePlanningAttachCache(id: string): void {
  planningAttachCache.delete(id);
}

/**
 * Restores a warm-attach payload into a fresh xterm.
 * When `result.snapshot` is set (daemon v3+), use serialized state only; do
 * not also write `replay` or transient PTY history would duplicate
 * scrollback. Order matches `src/daemon/terminalSnapshot.ts`: apply screen
 * (`snapshotAnsi`, modes excluded in serialize) then `rehydrateSequences`
 * for mode flags. Invokes `onComplete` after xterm has finished processing
 * the last chunk (or immediately when nothing to write).
 */
export function applyAttachResultToTerminal(
  terminal: TerminalHandle | null,
  result: AttachResult | null | undefined,
  onComplete: () => void,
): void {
  if (!terminal) {
    onComplete();
    return;
  }

  const snap = result?.snapshot;
  if (snap) {
    const a = snap.snapshotAnsi ?? '';
    const b = snap.rehydrateSequences ?? '';
    const afterFirst = () => {
      if (b.length > 0) {
        terminal.write(b, onComplete);
      } else {
        onComplete();
      }
    };
    if (a.length > 0) {
      terminal.write(a, afterFirst);
    } else {
      afterFirst();
    }
    return;
  }

  const replay = result?.replay ?? '';
  if (replay.length > 0) {
    terminal.write(replay, onComplete);
  } else {
    onComplete();
  }
}
