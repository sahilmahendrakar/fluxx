import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Session } from '../types';
import {
  pickSessionForTaskWorktree,
  resolveTaskWorktreePath,
} from './openWorkspacePath';

describe('pickSessionForTaskWorktree', () => {
  const mk = (id: string, taskId: string, repoId?: string): Session => ({
    id,
    taskId,
    projectId: 'p',
    repoId,
    worktreePath: `/wt/${taskId}`,
    branch: 'flux/task-x',
    status: 'running',
    startedAt: '',
  });

  it('prefers a session whose repoId matches when requested', () => {
    const sessions = [
      mk('s1', 't1', 'repo-a'),
      mk('s2', 't1', 'repo-b'),
    ];
    expect(pickSessionForTaskWorktree(sessions, 't1', 'repo-b')?.id).toBe('s2');
  });

  it('falls back to a legacy session without repoId when no exact match', () => {
    const sessions = [mk('s1', 't1', 'repo-a'), mk('s2', 't1')];
    expect(pickSessionForTaskWorktree(sessions, 't1', 'repo-z')?.id).toBe('s2');
  });
});

describe('resolveTaskWorktreePath lookup order', () => {
  async function tmpProject(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'flux-wt-'));
  }

  it('prefers daemon session path when present', async () => {
    const projectDir = await tmpProject();
    try {
      const sessPath = path.join(projectDir, 'session-wt');
      await fs.mkdir(sessPath, { recursive: true });
      const diskOther = path.join(projectDir, 'worktrees', 'rid', 'tid');
      await fs.mkdir(diskOther, { recursive: true });

      const r = await resolveTaskWorktreePath(
        'tid',
        async (): Promise<Session[]> => [
          {
            id: 's',
            taskId: 'tid',
            projectId: 'p',
            repoId: 'rid',
            worktreePath: sessPath,
            branch: 'b',
            status: 'running',
            startedAt: '',
          },
        ],
        projectDir,
        'rid',
      );
      expect(r).toBe(sessPath);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('uses worktrees/<repoId>/<taskId> before legacy flat when repoId is set', async () => {
    const projectDir = await tmpProject();
    try {
      const repoScoped = path.join(projectDir, 'worktrees', 'r1', 'tid');
      const legacyFlat = path.join(projectDir, 'worktrees', 'tid');
      await fs.mkdir(repoScoped, { recursive: true });
      await fs.mkdir(legacyFlat, { recursive: true });

      const r = await resolveTaskWorktreePath(
        'tid',
        async () => [],
        projectDir,
        'r1',
      );
      expect(r).toBe(repoScoped);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('falls back to legacy flat after repo-scoped when repoId is set', async () => {
    const projectDir = await tmpProject();
    try {
      const legacyFlat = path.join(projectDir, 'worktrees', 'tid');
      await fs.mkdir(legacyFlat, { recursive: true });

      const r = await resolveTaskWorktreePath(
        'tid',
        async () => [],
        projectDir,
        'missing-repo',
      );
      expect(r).toBe(legacyFlat);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('scans nested worktrees/*/<taskId> only when repoId is unset', async () => {
    const projectDir = await tmpProject();
    try {
      const nested = path.join(projectDir, 'worktrees', 'any-repo-id', 'tid');
      await fs.mkdir(nested, { recursive: true });

      const rUnset = await resolveTaskWorktreePath('tid', async () => [], projectDir);
      expect(rUnset).toBe(nested);

      const rSet = await resolveTaskWorktreePath(
        'tid',
        async () => [],
        projectDir,
        'other-repo',
      );
      expect(rSet).toBeNull();
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });
});
