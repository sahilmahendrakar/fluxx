import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../../types';
import type { DeviceStore } from '../DeviceStore';
import { SshTerminalBackend } from './SshTerminalBackend';
import { RoutingTerminalBackend } from './RoutingTerminalBackend';
import { LocalMainProcessTerminalBackend } from './LocalMainProcessTerminalBackend';
import { createMainTerminalBackend } from './createMainTerminalBackend';

vi.mock('../ssh/SshAttachBridge', () => ({
  SshAttachBridge: {
    create: vi.fn(() => ({
      isBridgeAttached: true,
      write: vi.fn(),
      resize: vi.fn(),
      killBridge: vi.fn(),
      dispose: vi.fn(),
      snapshot: vi.fn(async () => ({
        replay: '',
        cols: 80,
        rows: 24,
        streamSeq: 0,
      })),
    })),
  },
}));

const sshDevice = {
  id: 'devbox',
  kind: 'ssh' as const,
  displayName: 'Devbox',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tmux: { enabled: true },
  workspaceRoot: '~/.fluxx/workspaces',
  ssh: { host: 'devbox' },
};

function mockDeviceStore(): DeviceStore {
  return {
    getDevice: vi.fn((id: string) => (id === 'devbox' ? sshDevice : undefined)),
  } as unknown as DeviceStore;
}

function sampleSession(id = 'sess-1'): Session {
  return {
    id,
    taskId: 'task-1',
    projectId: 'proj-1',
    worktreePath: '/remote/worktree',
    branch: 'fluxx/task-1',
    status: 'running',
    startedAt: '2026-05-23T12:00:00.000Z',
    deviceId: 'devbox',
    deviceKind: 'ssh',
    deviceLabel: 'Devbox',
    remotePath: '/remote/worktree',
  };
}

describe('SshTerminalBackend', () => {
  it('registers remote sessions and routes write/resize through attach bridge', async () => {
    const frames: unknown[] = [];
    const helper = {
      runJsonCommand: vi.fn(),
    };
    const backend = new SshTerminalBackend({
      deviceStore: mockDeviceStore(),
      helper: helper as never,
      deliverStreamFrame: (frame) => frames.push(frame),
    });
    backend.registerTaskSession({
      session: sampleSession(),
      deviceId: 'devbox',
      tmuxSessionName: 'fluxx-task-proj-1-sess1',
      agent: 'cursor',
    });

    await expect(backend.listSessions()).resolves.toHaveLength(1);
    backend.writeSession('sess-1', 'pwd\r');
    backend.resizeSession('sess-1', 100, 30);

    await backend.stopSession('sess-1');
    expect(helper.runJsonCommand).toHaveBeenCalledWith(
      sshDevice,
      'stop-terminal',
      expect.objectContaining({ terminalId: 'sess-1', deviceId: 'devbox' }),
    );
    expect(frames.some((f) => (f as { kind?: string }).kind === 'session-exit')).toBe(true);
    await expect(backend.listSessions()).resolves.toEqual([]);
  });

  it('creates remote shells via helper start-shell RPC', async () => {
    const helper = {
      runJsonCommand: vi.fn(async (_device, command: string) => {
        if (command === 'start-shell') {
          return {
            ok: true,
            version: '0.2.2',
            data: {
              terminalId: 'shell-1',
              tmuxSessionName: 'fluxx-shell-proj-1-shell1',
              startedAt: '2026-05-23T12:01:00.000Z',
            },
          };
        }
        return { ok: true, version: '0.2.2', data: { stopped: true } };
      }),
    };
    const backend = new SshTerminalBackend({
      deviceStore: mockDeviceStore(),
      helper: helper as never,
      deliverStreamFrame: vi.fn(),
    });
    backend.registerTaskSession({
      session: sampleSession(),
      deviceId: 'devbox',
      tmuxSessionName: 'fluxx-task-proj-1-sess1',
    });

    const shell = await backend.createShell({
      sessionId: 'sess-1',
      worktreePath: '/remote/worktree',
      cols: 80,
      rows: 24,
    });
    expect(shell.deviceKind).toBe('ssh');
    expect(helper.runJsonCommand).toHaveBeenCalledWith(
      sshDevice,
      'start-shell',
      expect.objectContaining({
        parentSessionId: 'sess-1',
        cwd: '/remote/worktree',
      }),
    );
    await expect(backend.listShells('sess-1')).resolves.toHaveLength(1);
  });
});

describe('RoutingTerminalBackend', () => {
  it('routes session write/stop to ssh backend when session is remote', async () => {
    const local = new LocalMainProcessTerminalBackend({ deliverStreamFrame: vi.fn() });
    const ssh = new SshTerminalBackend({
      deviceStore: mockDeviceStore(),
      deliverStreamFrame: vi.fn(),
    });
    ssh.registerTaskSession({
      session: sampleSession('remote-1'),
      deviceId: 'devbox',
      tmuxSessionName: 'fluxx-task-proj-1-remote1',
    });
    const router = new RoutingTerminalBackend(local, ssh);
    const writeSpy = vi.spyOn(ssh, 'writeSession');
    const stopSpy = vi.spyOn(ssh, 'stopSession').mockResolvedValue();

    router.writeSession('remote-1', 'hi');
    await router.stopSession('remote-1');

    expect(writeSpy).toHaveBeenCalledWith('remote-1', 'hi');
    expect(stopSpy).toHaveBeenCalledWith('remote-1');
  });

  it('createMainTerminalBackend returns routing backend when deviceStore is provided', () => {
    const backend = createMainTerminalBackend({ deviceStore: mockDeviceStore() });
    expect(backend).toBeInstanceOf(RoutingTerminalBackend);
  });
});
