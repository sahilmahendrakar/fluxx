import { describe, expect, it } from 'vitest';
import {
  remoteDeviceManifestPath,
  remoteRepoCachePath,
  remoteTaskWorktreePath,
} from './remoteWorkspacePaths';

describe('remoteWorkspacePaths', () => {
  it('builds repo cache paths under workspace root without local home expansion', () => {
    expect(remoteRepoCachePath('~/.fluxx/workspaces', 'proj-1', 'repo-a')).toBe(
      '~/.fluxx/workspaces/repos/proj-1/repo-a',
    );
  });

  it('builds task worktree paths with project, repo, and task ids', () => {
    expect(
      remoteTaskWorktreePath('~/.fluxx/workspaces', 'proj-1', 'repo-a', 'task-9'),
    ).toBe('~/.fluxx/workspaces/worktrees/proj-1/repo-a/task-9');
  });

  it('sanitizes path segments with slashes', () => {
    expect(remoteTaskWorktreePath('/tmp/ws', 'a/b', 'c/d', 'e/f')).toBe(
      '/tmp/ws/worktrees/a_b/c_d/e_f',
    );
  });

  it('builds remote manifest path under ~/.fluxx/devices', () => {
    expect(remoteDeviceManifestPath('devbox-1')).toBe(
      '~/.fluxx/devices/devbox-1/terminal-sessions.json',
    );
  });
});
