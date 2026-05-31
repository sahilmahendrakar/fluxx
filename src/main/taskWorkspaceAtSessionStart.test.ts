import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTaskWorkspaceAtSessionStart,
  workspaceProviderKindForProject,
} from './taskWorkspaceAtSessionStart';
import type { RepoConfig } from '../types';

let repoRoot = '';
let repoCfg: RepoConfig;

describe('taskWorkspaceAtSessionStart', () => {
  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-gitless-'));
    repoCfg = {
      id: 'repo-1',
      rootPath: repoRoot,
      baseBranch: 'main',
    };
  });

  afterEach(async () => {
    if (repoRoot) {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
  it('workspaceProviderKindForProject selects direct when git is off', () => {
    expect(workspaceProviderKindForProject(false)).toBe('direct');
    expect(workspaceProviderKindForProject(true)).toBe('git');
  });

  it('createTaskWorkspaceAtSessionStart uses DirectFolderWorkspaceProvider when git off', async () => {
    const worktreeService = {
      create: vi.fn(),
    };
    const result = await createTaskWorkspaceAtSessionStart({
      gitEnabled: false,
      task: { id: 't1', title: 'Task' },
      repoCfg,
      worktreeService: worktreeService as never,
      sourceOpts: { sourceBranchShort: 'main', createSourceBranchIfMissing: false },
    });
    expect(worktreeService.create).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.descriptor.workspaceKind).toBe('direct');
    expect(result.descriptor.branch).toBe('');
    expect(result.descriptor.cwd).toBe(path.resolve(repoCfg.rootPath));
  });

  it('createTaskWorkspaceAtSessionStart uses worktree service when git on', async () => {
    const worktreeService = {
      create: vi.fn(async () => ({
        worktreePath: '/proj/worktrees/repo-1/flux-task',
        branch: 'flux/task-abc',
      })),
    };
    const result = await createTaskWorkspaceAtSessionStart({
      gitEnabled: true,
      task: { id: 't1', title: 'Task' },
      repoCfg,
      worktreeService: worktreeService as never,
      sourceOpts: { sourceBranchShort: 'main', createSourceBranchIfMissing: false },
    });
    expect(worktreeService.create).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.descriptor.workspaceKind).toBe('git');
    expect(result.descriptor.branch).toBe('flux/task-abc');
  });
});
