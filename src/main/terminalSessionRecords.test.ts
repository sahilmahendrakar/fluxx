import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TerminalSessionRecordStore } from './terminalSessionRecords';

describe('TerminalSessionRecordStore', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-terminal-sessions-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('records start and marks ended with reason', async () => {
    const store = new TerminalSessionRecordStore({ getProjectDir: () => tmp });
    await store.recordTerminalStart({
      id: 't1',
      kind: 'task',
      runtime: 'node-pty',
      projectId: 'p1',
      cwd: '/wt',
      command: 'claude',
      args: [],
      cols: 80,
      rows: 24,
      startedAt: '2020-01-01T00:00:00.000Z',
      task: {
        taskId: 'task-1',
        agent: 'claude-code',
        worktreePath: '/wt',
        fluxxWorkBranch: 'fluxx/x',
      },
    });
    await store.markTerminalEnded('t1', { reason: 'agent-exit-ok' });
    const rows = await store.listRecords();
    expect(rows).toHaveLength(1);
    expect(rows[0].endedReason).toBe('agent-exit-ok');
    expect(rows[0].endedAt).toBeTruthy();
    expect(await store.listOpenRecords()).toHaveLength(0);
  });

  it('merges task conversation id on open row', async () => {
    const store = new TerminalSessionRecordStore({ getProjectDir: () => tmp });
    await store.recordTerminalStart({
      id: 't1',
      kind: 'task',
      runtime: 'node-pty',
      projectId: 'p1',
      cwd: '/wt',
      command: 'cursor',
      args: ['agent'],
      cols: 80,
      rows: 24,
      startedAt: '2020-01-01T00:00:00.000Z',
      task: {
        taskId: 'task-1',
        agent: 'cursor',
        worktreePath: '/wt',
        fluxxWorkBranch: 'fluxx/x',
      },
    });
    await store.mergeTaskConversationId('t1', 'conv-99');
    const open = await store.listOpenRecords();
    expect(open[0]?.task?.agentConversationId).toBe('conv-99');
  });

  it('recovers from malformed file by resetting', async () => {
    await fs.writeFile(path.join(tmp, 'terminal-sessions.json'), '{ not json', 'utf8');
    const store = new TerminalSessionRecordStore({ getProjectDir: () => tmp });
    await store.recordTerminalStart({
      id: 's1',
      kind: 'shell',
      runtime: 'node-pty',
      projectId: 'p1',
      cwd: '/wt',
      command: '/bin/bash',
      args: ['-l'],
      cols: 80,
      rows: 24,
      startedAt: '2020-01-01T00:00:00.000Z',
      shell: { parentSessionId: 'parent', worktreePath: '/wt' },
    });
    const rows = await store.listRecords();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('shell');
  });
});
