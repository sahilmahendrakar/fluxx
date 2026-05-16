import type { AttachResult } from '../terminal-runtime/protocol';
import type { TerminalHandle } from '../components/Terminal';

/** In-flight `onData` chunk before the attach snapshot is applied. */
export type BufferedStreamChunk = { data: string; streamSeq?: number };

/**
 * `streamSeq` is from `AttachResult` / the snapshot boundary; `chunkSeq` is
 * from a live `data` frame. When both are set, drop chunks with
 * `chunkSeq <= streamSeq` after applying the snapshot to avoid duplicating
 * output that was already serialized.
 */
export function shouldPlayChunkAfterSnapshot(
  attachStreamSeq: number | undefined,
  chunkSeq: number | undefined,
): boolean {
  if (attachStreamSeq === undefined) return true;
  if (chunkSeq === undefined) return true;
  return chunkSeq > attachStreamSeq;
}

/** Writes pre-snapshot live chunks, skipping those already in the attach payload. */
export function writeBufferedStreamAfterSnapshot(
  terminal: Pick<TerminalHandle, 'write'> | null,
  buffer: BufferedStreamChunk[],
  attachStreamSeq: number | undefined,
) {
  for (const c of buffer) {
    if (shouldPlayChunkAfterSnapshot(attachStreamSeq, c.streamSeq)) {
      terminal?.write(c.data);
    }
  }
}

/**
 * In-flight attach promise maps. Module-scoped so React 18 dev StrictMode
 * double mounts coalesce to one `attach` RPC and do not double-apply a
 * payload. Entries are evicted in `finally` when the promise settles, so
 * a later remount (after the PTY has advanced) always issues a new attach
 * and gets a fresh snapshot.
 */
const sessionAttachInflight = new Map<string, Promise<AttachResult | null>>();
const shellAttachInflight = new Map<string, Promise<AttachResult | null>>();
const planningAttachInflight = new Map<string, Promise<AttachResult | null>>();

function getSharedInflight(
  map: Map<string, Promise<AttachResult | null>>,
  id: string,
  run: () => Promise<AttachResult | null>,
): Promise<AttachResult | null> {
  const existing = map.get(id);
  if (existing) return existing;
  const p = (async () => {
    try {
      return await run();
    } finally {
      map.delete(id);
    }
  })();
  map.set(id, p);
  return p;
}

/** Deduplicate concurrent session attach RPCs for the same id; do not cache completed results. */
export function getSessionAttachShared(
  id: string,
  run: () => Promise<AttachResult | null>,
): Promise<AttachResult | null> {
  return getSharedInflight(sessionAttachInflight, id, run);
}

export function getShellAttachShared(
  id: string,
  run: () => Promise<AttachResult | null>,
): Promise<AttachResult | null> {
  return getSharedInflight(shellAttachInflight, id, run);
}

export function getPlanningAttachShared(
  id: string,
  run: () => Promise<AttachResult | null>,
): Promise<AttachResult | null> {
  return getSharedInflight(planningAttachInflight, id, run);
}

export function invalidateSessionAttachCache(id: string): void {
  sessionAttachInflight.delete(id);
}

export function invalidateShellAttachCache(id: string): void {
  shellAttachInflight.delete(id);
}

export function invalidatePlanningAttachCache(id: string): void {
  planningAttachInflight.delete(id);
}

export interface ApplyAttachOptions {
  applyGeometry?: boolean;
  useSnapshot?: boolean;
  scrollToBottom?: boolean;
}

/**
 * Restores a warm-attach payload into a fresh xterm.
 * When `result.snapshot` is set, use serialized state only; do
 * not also write `replay` or transient PTY history would duplicate
 * scrollback. Order follows Superset's terminal-host restore helper: apply
 * `rehydrateSequences` before `snapshotAnsi` so DECSET/DECRST mode restores
 * cannot move the cursor after the serialized screen places it. Resizes the
 * xterm to snapshot (or attach) geometry first so line wrapping and cursor
 * state match. Invokes `onComplete` after xterm has finished processing the
 * last chunk (or immediately when nothing to write).
 */
export function applyAttachResultToTerminal(
  terminal: TerminalHandle | null,
  result: AttachResult | null | undefined,
  onComplete: () => void,
  options: ApplyAttachOptions = {},
): void {
  if (!terminal) {
    onComplete();
    return;
  }

  const {
    applyGeometry = true,
    useSnapshot = true,
    scrollToBottom = true,
  } = options;
  const complete = () => {
    if (scrollToBottom) {
      terminal.scrollToBottom();
    }
    onComplete();
  };

  const setGeom = (cols: number, rows: number) => {
    if (applyGeometry && cols > 0 && rows > 0) {
      terminal.setSnapshotGeometry(cols, rows);
    }
  };

  const snap = result?.snapshot;
  if (snap && useSnapshot) {
    terminal.reset();
    setGeom(snap.cols, snap.rows);
    const a = snap.snapshotAnsi ?? '';
    const b = snap.rehydrateSequences ?? '';
    const writeSnapshot = () => {
      if (a.length > 0) {
        terminal.write(a, complete);
      } else {
        complete();
      }
    };
    if (b.length > 0) {
      terminal.write(b, writeSnapshot);
    } else {
      writeSnapshot();
    }
    return;
  }

  if (result && result.cols > 0 && result.rows > 0) {
    terminal.reset();
    setGeom(result.cols, result.rows);
  }
  const replay = result?.replay ?? '';
  if (replay.length > 0) {
    terminal.write(replay, complete);
  } else {
    complete();
  }
}
