import { useEffect, useRef, type RefObject } from 'react';
import type { AttachResult } from '../daemon/protocol';
import type { TerminalHandle } from '../components/Terminal';
import {
  applyAttachResultToTerminal,
  type BufferedStreamChunk,
  writeBufferedStreamAfterSnapshot,
} from './warmAttach';
import {
  getApplyAttachOptionsForGeometryMode,
  shouldPostOwnerFitAfterAttach,
  type TerminalGeometryMode,
} from './terminalGeometryPolicy';

export type { TerminalGeometryMode } from './terminalGeometryPolicy';

export interface UseTerminalPtyStreamOptions {
  /** React ref to the `Terminal` handle. */
  terminalRef: RefObject<TerminalHandle | null>;
  /** PTY / stream id (session, shell, or planning id). */
  id: string;
  /** When false, the effect is disabled (e.g. session not running). */
  enabled: boolean;
  /** Owner: fit after attach and forward resize to PTY; mirror: replay at local size, no PTY resize. */
  geometryMode: TerminalGeometryMode;
  /**
   * Returns a promise of warm-attach data; callers usually wrap
   * `getSessionAttachShared` / `getShellAttachShared` / `getPlanningAttachShared` here.
   */
  getAttach: () => Promise<AttachResult | null>;
  /**
   * Subscribe to live PTY bytes. Must return an unsubscribe.
   * Signature matches session/shell/planning `onData(id, callback)`.
   */
  onStreamData: (
    id: string,
    cb: (data: string, streamSeq?: number) => void,
  ) => () => void;
  /**
   * Optional: called for every chunk from the wire (e.g. planning needs tail
   * heuristics even while the attach snapshot is not yet applied).
   */
  onDataChunk?: (data: string) => void;
}

/**
 * Buffers output until the warm-attach payload is applied, then flushes
 * post-`streamSeq` chunks. Centralizes owner vs mirror attach policy and
 * post-attach `fit()` for owner views.
 */
export function useTerminalPtyStream({
  terminalRef,
  id,
  enabled,
  geometryMode,
  getAttach,
  onStreamData,
  onDataChunk,
}: UseTerminalPtyStreamOptions): void {
  const getAttachRef = useRef(getAttach);
  getAttachRef.current = getAttach;
  const onStreamDataRef = useRef(onStreamData);
  onStreamDataRef.current = onStreamData;
  const onDataChunkRef = useRef(onDataChunk);
  onDataChunkRef.current = onDataChunk;

  useEffect(() => {
    if (!enabled) return;

    let streamReady = false;
    const earlyBuffer: BufferedStreamChunk[] = [];
    let cancelled = false;

    const unsub = onStreamDataRef.current(id, (data, streamSeq) => {
      if (cancelled) return;
      onDataChunkRef.current?.(data);
      if (!streamReady) {
        earlyBuffer.push({ data, streamSeq });
      } else {
        terminalRef.current?.write(data);
      }
    });

    void (async () => {
      const result = await getAttachRef.current();
      if (cancelled) return;
      const opts = getApplyAttachOptionsForGeometryMode(geometryMode);
      applyAttachResultToTerminal(terminalRef.current, result, () => {
        if (cancelled) return;
        if (shouldPostOwnerFitAfterAttach(geometryMode)) {
          terminalRef.current?.fit();
        }
        streamReady = true;
        writeBufferedStreamAfterSnapshot(
          terminalRef.current,
          earlyBuffer,
          result?.streamSeq,
        );
        earlyBuffer.length = 0;
      }, opts);
    })();

    return () => {
      cancelled = true;
      unsub();
    };
  }, [enabled, id, geometryMode, terminalRef]);
}
