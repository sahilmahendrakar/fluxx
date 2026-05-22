import { describe, expect, it } from 'vitest';
import { buildTerminalInventorySnapshot } from './terminalInventory';
import type { TerminalSessionRecord } from '../types';

describe('buildTerminalInventorySnapshot', () => {
  it('counts live running vs persisted open by kind', () => {
    const snapshot = buildTerminalInventorySnapshot(
      {
        sessions: [
          {
            id: 's1',
            taskId: 't1',
            projectId: 'p1',
            worktreePath: '/wt',
            branch: 'b',
            status: 'running',
            startedAt: 't',
          },
        ],
        planning: [
          {
            id: 'pl1',
            projectId: 'p1',
            agent: 'cursor',
            planningDir: '/plan',
            status: 'running',
            startedAt: 't',
          },
        ],
        shells: [
          {
            id: 'sh1',
            sessionId: 's1',
            worktreePath: '/wt',
            status: 'running',
            startedAt: 't',
          },
        ],
        sessionById: new Map([
          [
            's1',
            {
              id: 's1',
              taskId: 't1',
              projectId: 'p1',
              worktreePath: '/wt',
              branch: 'b',
              status: 'running',
              startedAt: 't',
            },
          ],
        ]),
      },
      [
        {
          id: 'old-task',
          kind: 'task',
          runtime: 'node-pty',
          projectId: 'p1',
          cwd: '/wt2',
          command: 'c',
          args: [],
          cols: 80,
          rows: 24,
          startedAt: 't0',
          task: {
            taskId: 't2',
            agent: 'cursor',
            worktreePath: '/wt2',
            fluxxWorkBranch: 'b',
          },
        } as TerminalSessionRecord,
      ],
      '/projects/p1',
    );

    expect(snapshot.live).toEqual({
      taskSessions: 1,
      planningSessions: 1,
      shells: 1,
      total: 3,
    });
    expect(snapshot.persistedOpen).toEqual({
      taskSessions: 1,
      planningSessions: 0,
      shells: 0,
      total: 1,
    });
    expect(snapshot.byProject.some((r) => r.projectId === 'p1' && r.taskSessions >= 2)).toBe(
      true,
    );
    expect(snapshot.byWorkspace.length).toBeGreaterThan(0);
  });
});
