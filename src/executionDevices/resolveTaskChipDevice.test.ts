import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { builtInLocalDeviceRef } from './parse';
import { resolveTaskChipExecutionDevice } from './resolveTaskChipDevice';

const task = (id: string, executionDevice?: Task['executionDevice']): Task => ({
  id,
  title: 't',
  status: 'backlog',
  agent: 'cursor',
  createdAt: '2026-01-01T00:00:00.000Z',
  projectId: 'p1',
  ...(executionDevice ? { executionDevice } : {}),
});

describe('resolveTaskChipExecutionDevice', () => {
  it('uses full effective resolution for local projects', () => {
    expect(
      resolveTaskChipExecutionDevice(task('a'), {
        projectDefaultDeviceId: 'devbox',
      }),
    ).toEqual({ kind: 'ssh', deviceId: 'devbox' });
  });

  it('on cloud shows only explicit row or local override, not defaults', () => {
    expect(
      resolveTaskChipExecutionDevice(task('a'), { projectDefaultDeviceId: 'devbox' }, {
        cloudProject: true,
      }),
    ).toBeUndefined();
    expect(
      resolveTaskChipExecutionDevice(
        task('a', { kind: 'ssh', deviceId: 'devbox' }),
        { projectDefaultDeviceId: 'other' },
        { cloudProject: true },
      ),
    ).toEqual({ kind: 'ssh', deviceId: 'devbox' });
    expect(
      resolveTaskChipExecutionDevice(task('a'), {
        cloudPerTaskOverrides: { a: { kind: 'ssh', deviceId: 'devbox' } },
      }, { cloudProject: true }),
    ).toEqual({ kind: 'ssh', deviceId: 'devbox' });
  });

  it('on cloud exposes shared runner refs from Firestore', () => {
    expect(
      resolveTaskChipExecutionDevice(
        task('a', { kind: 'runner', deviceId: 'r1', ownerUid: 'u1' }),
        {},
        { cloudProject: true },
      ),
    ).toEqual({ kind: 'runner', deviceId: 'r1', ownerUid: 'u1' });
  });

  it('local without defaults falls back to built-in local', () => {
    expect(resolveTaskChipExecutionDevice(task('a'), {})).toEqual(builtInLocalDeviceRef());
  });
});
