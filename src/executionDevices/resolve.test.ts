import { describe, expect, it } from 'vitest';
import {
  resolveDefaultExecutionDeviceForNewTask,
  resolveEffectiveExecutionDevice,
  resolveEffectiveExecutionDeviceForTask,
} from './resolve';
import { builtInLocalDeviceRef } from './parse';

describe('resolveEffectiveExecutionDevice', () => {
  it('prefers task explicit over overrides and defaults', () => {
    const ref = resolveEffectiveExecutionDevice({
      taskExecutionDevice: { kind: 'ssh', deviceId: 'devbox' },
      cloudPerTaskOverride: { kind: 'ssh', deviceId: 'other' },
      projectDefaultDeviceId: 'proj',
      globalDefaultDeviceId: 'global',
    });
    expect(ref).toEqual({ kind: 'ssh', deviceId: 'devbox' });
  });

  it('uses cloud per-task override when task has no field', () => {
    const ref = resolveEffectiveExecutionDevice({
      cloudPerTaskOverride: { kind: 'ssh', deviceId: 'devbox' },
      projectDefaultDeviceId: 'proj',
    });
    expect(ref).toEqual({ kind: 'ssh', deviceId: 'devbox' });
  });

  it('falls back project then global then built-in local', () => {
    expect(
      resolveEffectiveExecutionDevice({ projectDefaultDeviceId: 'devbox' }),
    ).toEqual({ kind: 'ssh', deviceId: 'devbox' });
    expect(
      resolveEffectiveExecutionDevice({ globalDefaultDeviceId: 'devbox' }),
    ).toEqual({ kind: 'ssh', deviceId: 'devbox' });
    expect(resolveEffectiveExecutionDevice({})).toEqual(builtInLocalDeviceRef());
  });

  it('maps project default local id to local kind', () => {
    expect(
      resolveEffectiveExecutionDevice({ projectDefaultDeviceId: 'local' }),
    ).toEqual(builtInLocalDeviceRef());
  });
});

describe('resolveEffectiveExecutionDeviceForTask legacy fallback', () => {
  it('returns local when task has no executionDevice', () => {
    expect(
      resolveEffectiveExecutionDeviceForTask({}, { globalDefaultDeviceId: 'devbox' }),
    ).toEqual({ kind: 'ssh', deviceId: 'devbox' });
    expect(resolveEffectiveExecutionDeviceForTask({}, {})).toEqual(builtInLocalDeviceRef());
  });
});

describe('resolveDefaultExecutionDeviceForNewTask', () => {
  it('snapshots project default before global', () => {
    expect(
      resolveDefaultExecutionDeviceForNewTask({
        projectDefaultDeviceId: 'devbox',
        globalDefaultDeviceId: 'other',
      }),
    ).toEqual({ kind: 'ssh', deviceId: 'devbox' });
  });
});
