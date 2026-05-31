import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildGitlessWorkspaceBusyKey,
  findGitlessWorkspaceBusyHolder,
  workspaceBusyErrorMessage,
} from './gitlessWorkspaceBusy';

describe('gitlessWorkspaceBusy', () => {
  it('buildGitlessWorkspaceBusyKey normalizes folder path', () => {
    expect(buildGitlessWorkspaceBusyKey('/proj/repo', 'local-device')).toBe(
      `${path.resolve('/proj/repo')}\0local-device`,
    );
  });

  it('findGitlessWorkspaceBusyHolder returns holder when guard key matches', () => {
    const folder = '/Users/me/myproject';
    const key = buildGitlessWorkspaceBusyKey(folder, 'dev-1');
    const holder = findGitlessWorkspaceBusyHolder(
      [
        {
          status: 'running',
          taskId: 'task-a',
          worktreePath: folder,
          workspaceKind: 'direct',
          deviceId: 'dev-1',
        },
      ],
      key,
      'task-b',
    );
    expect(holder).toEqual({ taskId: 'task-a' });
  });

  it('findGitlessWorkspaceBusyHolder ignores git worktrees and other devices', () => {
    const folder = '/Users/me/myproject';
    const key = buildGitlessWorkspaceBusyKey(folder, 'dev-1');
    expect(
      findGitlessWorkspaceBusyHolder(
        [
          {
            status: 'running',
            taskId: 'task-a',
            worktreePath: '/flux/worktrees/repo/task-a',
            workspaceKind: 'git',
            deviceId: 'dev-1',
          },
          {
            status: 'running',
            taskId: 'task-b',
            worktreePath: folder,
            workspaceKind: 'direct',
            deviceId: 'dev-2',
          },
        ],
        key,
        'task-new',
      ),
    ).toBeNull();
  });

  it('findGitlessWorkspaceBusyHolder returns null when guard off would allow same folder', () => {
    const folder = '/Users/me/myproject';
    const key = buildGitlessWorkspaceBusyKey(folder, 'dev-1');
    expect(
      findGitlessWorkspaceBusyHolder(
        [
          {
            status: 'stopped',
            taskId: 'task-a',
            worktreePath: folder,
            workspaceKind: 'direct',
            deviceId: 'dev-1',
          },
        ],
        key,
        'task-b',
      ),
    ).toBeNull();
  });

  it('workspaceBusyErrorMessage names the holding task', () => {
    expect(workspaceBusyErrorMessage('task-abc', 'Fix login')).toContain('Fix login');
  });
});
