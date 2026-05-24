import { describe, expect, it, vi } from 'vitest';
import type { ExecutionDeviceConfig } from '../../types';
import { SshTerminalBackend } from '../terminalBackend/SshTerminalBackend';
import {
  reconcileRemoteSshTerminalsForProject,
  remoteManifestRowToTerminalRecord,
} from './remoteSshTerminalReconcile';

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

function mockDeviceStore() {
  return {
    getDevice: vi.fn((id: string) => (id === 'devbox' ? sshDevice : undefined)),
  };
}

describe('remoteSshTerminalReconcile', () => {
  it('remoteManifestRowToTerminalRecord maps task rows', () => {
    const record = remoteManifestRowToTerminalRecord({
      id: 'term-1',
      kind: 'task',
      runtime: 'tmux',
      projectId: 'p1',
      cwd: '/remote/wt',
      command: 'agent',
      args: [],
      startedAt: '2026-05-23T12:00:00.000Z',
      tmuxSessionName: 'fluxx-task-p1-term1',
      task: {
        taskId: 'task-1',
        agent: 'cursor',
        worktreePath: '/remote/wt',
        fluxxWorkBranch: 'fluxx/task-1',
      },
    });
    expect(record.kind).toBe('task');
    expect(record.task?.taskId).toBe('task-1');
  });

  it('restores running remote task sessions when tmux and worktree exist', async () => {
    const helper = {
      ensureInstalled: vi.fn(async () => ({ ok: true, version: '0.2.6' })),
      runJsonCommand: vi.fn(async (_device, command: string) => {
        if (command === 'list-terminals') {
          return {
            ok: true,
            version: '0.2.6',
            data: {
              terminals: [
                {
                  id: 'term-1',
                  kind: 'task',
                  runtime: 'tmux',
                  projectId: 'p1',
                  deviceId: 'devbox',
                  deviceKind: 'ssh',
                  cwd: '/remote/wt',
                  tmuxSessionName: 'fluxx-task-p1-term1',
                  command: 'agent',
                  args: [],
                  startedAt: '2026-05-23T12:00:00.000Z',
                  task: {
                    taskId: 'task-1',
                    agent: 'cursor',
                    worktreePath: '/remote/wt',
                    fluxxWorkBranch: 'fluxx/task-1',
                  },
                },
              ],
            },
          };
        }
        if (command === 'list-tmux-sessions') {
          return {
            ok: true,
            version: '0.2.6',
            data: { sessionNames: ['fluxx-task-p1-term1', 'fluxx-untracked'] },
          };
        }
        if (command === 'path-exists') {
          return { ok: true, version: '0.2.6', data: { exists: true } };
        }
        return { ok: false, code: 'INTERNAL', message: 'unexpected' };
      }),
    };

    const sshBackend = new SshTerminalBackend({
      deviceStore: mockDeviceStore() as never,
      helper: helper as never,
      deliverStreamFrame: vi.fn(),
    });

    const result = await reconcileRemoteSshTerminalsForProject({
      projectId: 'p1',
      devices: [sshDevice],
      helper: helper as never,
      sshBackend,
    });

    expect(result.restored.task).toBe(1);
    expect(result.untrackedFluxxSessions).toEqual(['fluxx-untracked']);
    expect(sshBackend.hasSession('term-1')).toBe(true);
    await expect(sshBackend.listSessions()).resolves.toHaveLength(1);
  });

  it('marks device-unreachable rows interrupted without restore', async () => {
    const helper = {
      ensureInstalled: vi.fn(async () => ({
        ok: false,
        phase: 'helper-handshake',
        message: 'offline',
      })),
      runJsonCommand: vi.fn(),
    };

    const sshBackend = new SshTerminalBackend({
      deviceStore: mockDeviceStore() as never,
      helper: helper as never,
      deliverStreamFrame: vi.fn(),
    });

    const result = await reconcileRemoteSshTerminalsForProject({
      projectId: 'p1',
      devices: [sshDevice],
      helper: helper as never,
      sshBackend,
      localOpenRecords: [
        {
          id: 'term-offline',
          kind: 'task',
          runtime: 'tmux',
          projectId: 'p1',
          deviceId: 'devbox',
          deviceKind: 'ssh',
          cwd: '/remote/wt',
          command: 'agent',
          args: [],
          cols: 80,
          rows: 24,
          startedAt: '2026-05-23T12:00:00.000Z',
          tmuxSessionName: 'fluxx-task-p1-offline',
          task: {
            taskId: 'task-1',
            agent: 'cursor',
            worktreePath: '/remote/wt',
            fluxxWorkBranch: 'fluxx/task-1',
          },
        },
      ],
    });

    expect(result.restored.task).toBe(0);
    expect(result.interruptedRecords).toHaveLength(1);
    expect(result.interruptedRecords[0]?.lifecycleStatus).toBe('device-unreachable');
    expect(sshBackend.hasSession('term-offline')).toBe(false);
  });

  it('reports tmux-missing without registering a warm session', async () => {
    const helper = {
      ensureInstalled: vi.fn(async () => ({ ok: true, version: '0.2.6' })),
      runJsonCommand: vi.fn(async (_device, command: string) => {
        if (command === 'list-terminals') {
          return {
            ok: true,
            version: '0.2.6',
            data: {
              terminals: [
                {
                  id: 'term-missing',
                  kind: 'task',
                  runtime: 'tmux',
                  projectId: 'p1',
                  deviceId: 'devbox',
                  cwd: '/remote/wt',
                  tmuxSessionName: 'fluxx-task-p1-missing',
                  command: 'agent',
                  args: [],
                  startedAt: '2026-05-23T12:00:00.000Z',
                  task: {
                    taskId: 'task-1',
                    agent: 'cursor',
                    worktreePath: '/remote/wt',
                    fluxxWorkBranch: 'fluxx/task-1',
                  },
                },
              ],
            },
          };
        }
        if (command === 'list-tmux-sessions') {
          return { ok: true, version: '0.2.6', data: { sessionNames: [] } };
        }
        if (command === 'path-exists') {
          return { ok: true, version: '0.2.6', data: { exists: true } };
        }
        return { ok: false, code: 'INTERNAL', message: 'unexpected' };
      }),
    };

    const sshBackend = new SshTerminalBackend({
      deviceStore: mockDeviceStore() as never,
      helper: helper as never,
      deliverStreamFrame: vi.fn(),
    });

    const result = await reconcileRemoteSshTerminalsForProject({
      projectId: 'p1',
      devices: [sshDevice],
      helper: helper as never,
      sshBackend,
    });

    expect(result.missing.task).toBe(1);
    expect(result.interruptedRecords[0]?.lifecycleStatus).toBe('tmux-missing');
    expect(sshBackend.hasSession('term-missing')).toBe(false);
  });
});
