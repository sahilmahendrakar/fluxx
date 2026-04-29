import { describe, expect, it } from 'vitest';
import type { Agent } from '../types';
import type { AttachResult, PlanningAttachResult, TerminalModes, TerminalSnapshot } from './protocol';

const allOffModes = (): TerminalModes => ({
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
});

const agent: Agent = 'claude-code';

/**
 * Simulates how attach results cross NDJSON and Electron IPC: structured-clone
 * and JSON only preserve plain data, so the contract must be plain objects.
 */
function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('attach wire shape', () => {
  it('AttachResult with snapshot round-trips like daemon RPC / IPC', () => {
    const modes = allOffModes();
    const snapshot: TerminalSnapshot = {
      snapshotAnsi: '\x1b[2J',
      rehydrateSequences: '',
      modes,
      cols: 40,
      rows: 5,
    };
    const payload: AttachResult = {
      replay: 'x',
      cols: 40,
      rows: 5,
      streamSeq: 2,
      snapshot,
    };
    const round = jsonRoundTrip(payload);
    expect(round.replay).toBe('x');
    expect(round.snapshot).toBeDefined();
    expect(round.snapshot?.snapshotAnsi).toBe('\x1b[2J');
    expect(typeof round.snapshot?.modes.bracketedPaste).toBe('boolean');
    expect(round.streamSeq).toBe(2);
  });

  it('PlanningAttachResult includes session and attach fields', () => {
    const attach: AttachResult = { replay: '', cols: 80, rows: 24, streamSeq: 0 };
    const session: PlanningAttachResult['session'] = {
      id: 'p1',
      projectId: 'proj',
      agent,
      planningDir: '/tmp/planning',
      status: 'running',
      startedAt: '2020-01-01',
    };
    const merged: PlanningAttachResult = { ...attach, session };
    const round = jsonRoundTrip(merged);
    expect(round.session.id).toBe('p1');
    expect(round.replay).toBe('');
  });
});
