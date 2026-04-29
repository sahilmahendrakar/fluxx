import { describe, expect, it, vi } from 'vitest';
import type { AttachResult, TerminalModes } from '../daemon/protocol';
import {
  applyAttachResultToTerminal,
  getPlanningAttachShared,
  getSessionAttachShared,
  getShellAttachShared,
  shouldPlayChunkAfterSnapshot,
  writeBufferedStreamAfterSnapshot,
} from './warmAttach';
import type { TerminalHandle } from '../components/Terminal';

const zeroModes: TerminalModes = {
  applicationCursorKeys: false,
  originMode: false,
  autoWrap: true,
  cursorVisible: true,
  alternateScreen: false,
  mouseX10: false,
  mouseVT200: false,
  mouseHighlight: false,
  mouseCellMotion: false,
  mouseAllMotion: false,
  mouseUTF8: false,
  mouseSGR: false,
  focusReporting: false,
  bracketedPaste: false,
};

function mockTerm(): {
  term: TerminalHandle;
  writes: string[];
  getLastGeom: () => { cols: number; rows: number } | null;
} {
  const writes: string[] = [];
  const geom = { value: null as { cols: number; rows: number } | null };
  const term: TerminalHandle = {
    write: (data: string, callback?: () => void) => {
      writes.push(data);
      queueMicrotask(() => callback?.());
    },
    focus: () => undefined,
    fit: () => undefined,
    scrollToBottom: () => undefined,
    setSnapshotGeometry: (cols, rows) => {
      geom.value = { cols, rows };
    },
  };
  return { term, writes, getLastGeom: () => geom.value };
}

describe('applyAttachResultToTerminal', () => {
  it('writes snapshotAnsi then rehydrateSequences; ignores replay', async () => {
    const { term, writes, getLastGeom } = mockTerm();
    const result: AttachResult = {
      replay: 'REPLAY_DUP',
      cols: 80,
      rows: 24,
      streamSeq: 1,
      snapshot: {
        snapshotAnsi: 'SCREEN',
        rehydrateSequences: 'MODES',
        modes: zeroModes,
        cols: 80,
        rows: 24,
      },
    };
    await new Promise<void>((resolve) => {
      applyAttachResultToTerminal(term, result, resolve);
    });
    expect(getLastGeom()).toEqual({ cols: 80, rows: 24 });
    expect(writes).toEqual(['SCREEN', 'MODES']);
  });

  it('uses legacy replay when snapshot is absent', async () => {
    const { term, writes, getLastGeom } = mockTerm();
    const result: AttachResult = {
      replay: 'OLD',
      cols: 80,
      rows: 24,
      streamSeq: 0,
    };
    await new Promise<void>((resolve) => {
      applyAttachResultToTerminal(term, result, resolve);
    });
    expect(getLastGeom()).toEqual({ cols: 80, rows: 24 });
    expect(writes).toEqual(['OLD']);
  });

  it('invokes onComplete when there is no payload', () => {
    const { term, writes } = mockTerm();
    let done = false;
    applyAttachResultToTerminal(term, { replay: '', cols: 0, rows: 0, streamSeq: 0 }, () => {
      done = true;
    });
    expect(done).toBe(true);
    expect(writes).toEqual([]);
  });

  it('can replay without applying snapshot geometry', async () => {
    const { term, writes, getLastGeom } = mockTerm();
    const result: AttachResult = {
      replay: 'PANEL_REPLAY',
      cols: 141,
      rows: 33,
      streamSeq: 1,
      snapshot: {
        snapshotAnsi: 'FULL_TAB_SCREEN',
        rehydrateSequences: 'MODES',
        modes: zeroModes,
        cols: 141,
        rows: 33,
      },
    };
    await new Promise<void>((resolve) => {
      applyAttachResultToTerminal(term, result, resolve, {
        applyGeometry: false,
        useSnapshot: false,
      });
    });
    expect(getLastGeom()).toBeNull();
    expect(writes).toEqual(['PANEL_REPLAY']);
  });
});

describe('shouldPlayChunkAfterSnapshot / writeBufferedStreamAfterSnapshot', () => {
  it('drops buffered chunks at or before the snapshot streamSeq', () => {
    expect(shouldPlayChunkAfterSnapshot(3, 1)).toBe(false);
    expect(shouldPlayChunkAfterSnapshot(3, 3)).toBe(false);
    expect(shouldPlayChunkAfterSnapshot(3, 4)).toBe(true);
  });

  it('keeps all chunks when attach has no streamSeq (legacy)', () => {
    expect(shouldPlayChunkAfterSnapshot(undefined, 99)).toBe(true);
  });

  it('keeps chunks with no seq when streamSeq is set (legacy stream)', () => {
    expect(shouldPlayChunkAfterSnapshot(5, undefined)).toBe(true);
  });

  it('flushes only post-boundary data in order', () => {
    const out: string[] = [];
    const t: Pick<TerminalHandle, 'write'> = {
      write: (d) => out.push(d),
    };
    writeBufferedStreamAfterSnapshot(
      t,
      [
        { data: 'a', streamSeq: 1 },
        { data: 'b', streamSeq: 2 },
        { data: 'c', streamSeq: 3 },
        { data: 'NEW', streamSeq: 4 },
      ],
      3,
    );
    expect(out).toEqual(['NEW']);
  });
});

const minimalAttach: AttachResult = { replay: '', cols: 80, rows: 24, streamSeq: 0 };

describe('getSessionAttachShared', () => {
  it('dedupes concurrent callers to one in-flight run()', async () => {
    const runA = vi.fn();
    const runB = vi.fn();
    const deferred = new Deferred<AttachResult | null>();
    runA.mockReturnValueOnce(deferred.promise);
    const p1 = getSessionAttachShared('s1', () => runA());
    const p2 = getSessionAttachShared('s1', () => runB());
    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).not.toHaveBeenCalled();
    deferred.resolve(minimalAttach);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(minimalAttach);
    expect(b).toBe(minimalAttach);
  });

  it('issues a new attach after the previous in-flight run settles', async () => {
    const run = vi.fn();
    run.mockResolvedValue(minimalAttach);
    await getSessionAttachShared('s1', () => run());
    await getSessionAttachShared('s1', () => run());
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('issues separate attaches for different ids in parallel', async () => {
    const run = vi.fn();
    const d1 = new Deferred<AttachResult | null>();
    const d2 = new Deferred<AttachResult | null>();
    run
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);
    const p1 = getSessionAttachShared('a', () => run());
    const p2 = getSessionAttachShared('b', () => run());
    d1.resolve(minimalAttach);
    d2.resolve(minimalAttach);
    await Promise.all([p1, p2]);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('getShellAttachShared and getPlanningAttachShared', () => {
  it('use independent maps (same id does not cross)', async () => {
    const shellRun = vi.fn();
    const planRun = vi.fn();
    const d1 = new Deferred<AttachResult | null>();
    const d2 = new Deferred<AttachResult | null>();
    shellRun.mockReturnValueOnce(d1.promise);
    planRun.mockReturnValueOnce(d2.promise);
    const ps = getShellAttachShared('x', () => shellRun());
    const pp = getPlanningAttachShared('x', () => planRun());
    d1.resolve(minimalAttach);
    d2.resolve(minimalAttach);
    await Promise.all([ps, pp]);
    expect(shellRun).toHaveBeenCalledTimes(1);
    expect(planRun).toHaveBeenCalledTimes(1);
  });
});

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (v: T) => void;
  reject!: (e: unknown) => void;
  constructor() {
    this.promise = new Promise((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
  }
}
