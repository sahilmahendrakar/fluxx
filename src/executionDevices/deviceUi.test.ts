import { describe, expect, it } from 'vitest';
import type { ExecutionDeviceConfig } from '../types';
import {
  buildDevicePickerOptions,
  deviceAvailabilityForRef,
  deviceUsesTmuxPersistence,
  isTaskExecutionDeviceEditable,
  resolveNewTaskDeviceRef,
} from './deviceUi';
import { builtInLocalDeviceRef } from './parse';

const localDevice: ExecutionDeviceConfig = {
  id: 'local',
  kind: 'local',
  displayName: 'This computer',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tmux: { enabled: false },
  workspaceRoot: '~/.fluxx/worktrees',
};

const sshDevice: ExecutionDeviceConfig = {
  id: 'devbox',
  kind: 'ssh',
  displayName: 'Devbox',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tmux: { enabled: true },
  workspaceRoot: '~/.fluxx/workspaces',
  ssh: { host: 'devbox' },
};

describe('resolveNewTaskDeviceRef', () => {
  it('uses explicit ref when provided', () => {
    expect(
      resolveNewTaskDeviceRef({
        explicitRef: { kind: 'ssh', deviceId: 'devbox' },
        projectDefaultDeviceId: 'other',
      }),
    ).toEqual({ kind: 'ssh', deviceId: 'devbox' });
  });

  it('falls back project then global default', () => {
    expect(
      resolveNewTaskDeviceRef({
        projectDefaultDeviceId: 'devbox',
        globalDefaultDeviceId: 'other',
      }),
    ).toEqual({ kind: 'ssh', deviceId: 'devbox' });
    expect(resolveNewTaskDeviceRef({ globalDefaultDeviceId: 'devbox' })).toEqual({
      kind: 'ssh',
      deviceId: 'devbox',
    });
    expect(resolveNewTaskDeviceRef({})).toEqual(builtInLocalDeviceRef());
  });
});

describe('isTaskExecutionDeviceEditable', () => {
  it('blocks changes while session is running', () => {
    expect(isTaskExecutionDeviceEditable('running')).toBe(false);
    expect(isTaskExecutionDeviceEditable('idle')).toBe(true);
    expect(isTaskExecutionDeviceEditable(undefined)).toBe(true);
  });
});

describe('buildDevicePickerOptions', () => {
  it('omits disabled devices by default', () => {
    const disabled: ExecutionDeviceConfig = { ...sshDevice, id: 'off', enabled: false };
    const options = buildDevicePickerOptions([localDevice, disabled, sshDevice]);
    expect(options.map((o) => o.ref.deviceId)).toEqual(['local', 'devbox']);
  });

  it('shows agent warning hint without disabling an available ssh device', () => {
    const probed: ExecutionDeviceConfig = {
      ...sshDevice,
      lastProbe: {
        status: 'available',
        checkedAt: '2026-01-02T00:00:00.000Z',
        capabilities: {
          agents: [
            { command: 'claude', found: false },
            { command: 'agent', found: false },
            { command: 'codex', found: false },
          ],
        },
      },
    };
    const [option] = buildDevicePickerOptions([probed]);
    expect(option.disabled).toBe(false);
    expect(option.hint).toContain('No agent CLIs');
  });
});

describe('deviceUsesTmuxPersistence', () => {
  it('is true only when tmux.enabled is set', () => {
    expect(deviceUsesTmuxPersistence({ ...localDevice, tmux: { enabled: true } })).toBe(true);
    expect(deviceUsesTmuxPersistence({ ...localDevice, tmux: { enabled: false } })).toBe(false);
  });
});

describe('deviceAvailabilityForRef', () => {
  it('detects missing and cloud-without-override states', () => {
    expect(
      deviceAvailabilityForRef([localDevice], { kind: 'ssh', deviceId: 'gone' }),
    ).toBe('missing');
    expect(
      deviceAvailabilityForRef([localDevice], undefined, {
        cloudProject: true,
        hasExplicitTaskDevice: false,
      }),
    ).toBe('cloud-no-local-override');
  });
});
