import { describe, expect, it } from 'vitest';
import type { TerminalSessionRecord } from '../../types';
import {
  findUntrackedFluxxTmuxSessions,
  formatTmuxReconcileLogLine,
  isOpenTmuxManifestRow,
  sortOpenTmuxRowsForRestore,
} from './tmuxTerminalReconcile';

function tmuxRow(
  partial: Partial<TerminalSessionRecord> & Pick<TerminalSessionRecord, 'id' | 'kind'>,
): TerminalSessionRecord {
  return {
    runtime: 'tmux',
    projectId: 'p1',
    cwd: '/cwd',
    command: 'agent',
    args: [],
    cols: 80,
    rows: 24,
    startedAt: '2026-01-01T00:00:00.000Z',
    tmuxSessionName: `fluxx-${partial.kind}-p1-${partial.id}`,
    ...partial,
  };
}

describe('tmuxTerminalReconcile helpers', () => {
  it('isOpenTmuxManifestRow filters ended and non-tmux rows', () => {
    const open = tmuxRow({
      id: 'a',
      kind: 'task',
      task: {
        taskId: 't1',
        agent: 'cursor',
        worktreePath: '/wt',
        fluxxWorkBranch: 'b',
      },
    });
    const ended = { ...open, endedAt: '2026-01-02T00:00:00.000Z' };
    const direct = { ...open, runtime: 'node-pty' as const };
    expect(isOpenTmuxManifestRow(open, 'p1')).toBe(true);
    expect(isOpenTmuxManifestRow(ended, 'p1')).toBe(false);
    expect(isOpenTmuxManifestRow(direct, 'p1')).toBe(false);
    expect(isOpenTmuxManifestRow(open, 'other')).toBe(false);
  });

  it('sortOpenTmuxRowsForRestore orders task, planning, shell', () => {
    const shell = tmuxRow({
      id: 'sh',
      kind: 'shell',
      shell: { parentSessionId: 'task-s', worktreePath: '/wt' },
    });
    const task = tmuxRow({
      id: 'task-s',
      kind: 'task',
      task: {
        taskId: 't1',
        agent: 'cursor',
        worktreePath: '/wt',
        fluxxWorkBranch: 'b',
      },
    });
    const planning = tmuxRow({ id: 'pl', kind: 'planning', planning: { agent: 'cursor', planningDir: '/p' } });
    const sorted = sortOpenTmuxRowsForRestore([shell, planning, task], 'p1').map((r) => r.kind);
    expect(sorted).toEqual(['task', 'planning', 'shell']);
  });

  it('findUntrackedFluxxTmuxSessions ignores non-fluxx and tracked names', () => {
    const tracked = new Set(['fluxx-task-p1-a']);
    const all = ['fluxx-task-p1-a', 'fluxx-task-p1-b', 'other-session', 'fluxx-planning-p1-x'];
    expect(findUntrackedFluxxTmuxSessions(all, tracked)).toEqual([
      'fluxx-task-p1-b',
      'fluxx-planning-p1-x',
    ]);
  });

  it('formatTmuxReconcileLogLine includes untracked session names', () => {
    const line = formatTmuxReconcileLogLine({
      restored: { task: 1, planning: 0, shell: 2 },
      missing: { task: 0, planning: 1, shell: 0 },
      workspaceMissing: { task: 0, planning: 0, shell: 0 },
      skipped: 3,
      untrackedFluxxSessions: ['fluxx-task-p1-orphan'],
    });
    expect(line).toContain('restored task=1');
    expect(line).toContain('untrackedFluxx=1');
    expect(line).toContain('fluxx-task-p1-orphan');
  });
});
