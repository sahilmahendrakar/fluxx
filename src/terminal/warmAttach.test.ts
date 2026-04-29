import { describe, expect, it } from 'vitest';
import type { AttachResult, TerminalModes } from '../daemon/protocol';
import { applyAttachResultToTerminal } from './warmAttach';
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

function mockTerm(): { term: TerminalHandle; writes: string[] } {
  const writes: string[] = [];
  const term: TerminalHandle = {
    write: (data: string, callback?: () => void) => {
      writes.push(data);
      queueMicrotask(() => callback?.());
    },
    focus: () => undefined,
  };
  return { term, writes };
}

describe('applyAttachResultToTerminal', () => {
  it('writes snapshotAnsi then rehydrateSequences; ignores replay', async () => {
    const { term, writes } = mockTerm();
    const result: AttachResult = {
      replay: 'REPLAY_DUP',
      cols: 80,
      rows: 24,
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
    expect(writes).toEqual(['SCREEN', 'MODES']);
  });

  it('uses legacy replay when snapshot is absent', async () => {
    const { term, writes } = mockTerm();
    const result: AttachResult = {
      replay: 'OLD',
      cols: 80,
      rows: 24,
    };
    await new Promise<void>((resolve) => {
      applyAttachResultToTerminal(term, result, resolve);
    });
    expect(writes).toEqual(['OLD']);
  });

  it('invokes onComplete when there is no payload', () => {
    const { term, writes } = mockTerm();
    let done = false;
    applyAttachResultToTerminal(term, { replay: '', cols: 0, rows: 0 }, () => {
      done = true;
    });
    expect(done).toBe(true);
    expect(writes).toEqual([]);
  });
});
