import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import {
  taskHasBlockingWorkspaceState,
  taskSourceBranchSettingsWouldChange,
} from './taskSourceBranchGuard';

describe('taskSourceBranchSettingsWouldChange', () => {
  const base: Task = {
    id: '1',
    title: 't',
    status: 'backlog',
    agent: 'cursor',
    createdAt: '',
    projectId: 'p',
    sourceBranch: 'main',
    createSourceBranchIfMissing: false,
  };

  it('returns false when patch does not touch source fields', () => {
    expect(taskSourceBranchSettingsWouldChange(base, {}, 'main')).toBe(false);
  });

  it('returns true when sourceBranch effective value changes', () => {
    expect(taskSourceBranchSettingsWouldChange(base, { sourceBranch: 'develop' }, 'main')).toBe(
      true,
    );
  });

  it('treats clearing sourceBranch as reverting to project default', () => {
    const onDevelop = { ...base, sourceBranch: 'develop' };
    expect(taskSourceBranchSettingsWouldChange(onDevelop, { sourceBranch: '  ' }, 'main')).toBe(
      true,
    );
  });

  it('returns true when createSourceBranchIfMissing changes', () => {
    expect(
      taskSourceBranchSettingsWouldChange(base, { createSourceBranchIfMissing: true }, 'main'),
    ).toBe(true);
  });

  it('returns false for no-op sourceBranch trim to same name', () => {
    expect(taskSourceBranchSettingsWouldChange(base, { sourceBranch: ' main ' }, 'main')).toBe(
      false,
    );
  });
});

describe('taskHasBlockingWorkspaceState', () => {
  it('returns true when a session exists for the task', async () => {
    const hit = await taskHasBlockingWorkspaceState({
      taskId: 'tid',
      listSessions: async () => [{ taskId: 'tid' }],
      projectDir: '/tmp',
      repoGitRoots: ['/tmp'],
    });
    expect(hit).toBe(true);
  });

  it('returns false when no session, no dir, no branch', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-guard-'));
    try {
      const hit = await taskHasBlockingWorkspaceState({
        taskId: 'missing-task',
        listSessions: async () => [],
        projectDir: cwd,
        repoGitRoots: [cwd],
      });
      expect(hit).toBe(false);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('detects repo-scoped worktrees/<repoId>/<taskId> when repoId is provided', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-guard-repo-'));
    try {
      await fs.mkdir(path.join(cwd, 'worktrees', 'rid', 'tid'), { recursive: true });
      const hit = await taskHasBlockingWorkspaceState({
        taskId: 'tid',
        repoId: 'rid',
        listSessions: async () => [],
        projectDir: cwd,
        repoGitRoots: [cwd],
      });
      expect(hit).toBe(true);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
