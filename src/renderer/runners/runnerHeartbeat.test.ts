import { describe, expect, it } from 'vitest';
import type { Session } from '../../types';
import {
  activeTaskIdsForRunnerHeartbeat,
  sessionEligibleForRunnerHeartbeat,
} from './runnerHeartbeat';

const session = (partial: Partial<Session> & Pick<Session, 'taskId'>): Session => ({
  id: 's1',
  taskId: partial.taskId,
  projectId: partial.projectId ?? 'p1',
  status: partial.status ?? 'running',
  worktreePath: '/tmp/wt',
  startedAt: '2026-01-01T00:00:00.000Z',
  ...partial,
});

describe('runnerHeartbeat', () => {
  it('excludes direct SSH running sessions', () => {
    expect(
      sessionEligibleForRunnerHeartbeat(
        session({ taskId: 't1', deviceKind: 'ssh', deviceId: 'devbox' }),
        'p1',
      ),
    ).toBe(false);
    expect(
      sessionEligibleForRunnerHeartbeat(session({ taskId: 't1', deviceKind: 'local' }), 'p1'),
    ).toBe(true);
  });

  it('collects only eligible task ids', () => {
    const ids = activeTaskIdsForRunnerHeartbeat(
      [
        session({ taskId: 'local', deviceKind: 'local' }),
        session({ taskId: 'ssh', deviceKind: 'ssh', deviceId: 'devbox' }),
        session({ taskId: 'other', status: 'stopped' }),
      ],
      'p1',
    );
    expect([...ids]).toEqual(['local']);
  });
});
