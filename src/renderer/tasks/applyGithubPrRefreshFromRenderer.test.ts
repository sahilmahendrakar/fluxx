import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../types';
import { applyGithubPrRefreshFromRenderer } from './applyGithubPrRefreshFromRenderer';
import type { TaskProvider } from './TaskProvider';

const baseTask = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'x',
  status: 'in-progress',
  agent: 'claude-code',
  createdAt: '1',
  projectId: 'p1',
  ...over,
});

describe('applyGithubPrRefreshFromRenderer', () => {
  it('reloads from main for local projects', async () => {
    const reloadFromMain = vi.fn().mockResolvedValue(undefined);
    const provider: TaskProvider = {
      subscribe: vi.fn().mockReturnValue(vi.fn()),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      reloadFromMain,
    };
    await applyGithubPrRefreshFromRenderer({
      projectKind: 'local',
      taskId: 't1',
      live: baseTask(),
      snapshot: [baseTask()],
      result: {
        ok: true,
        githubPr: { url: 'https://github.com/o/r/pull/1', state: 'open' },
        persisted: true,
      },
      provider,
      autoMarkDoneWhenPrMerged: false,
      autoMoveToReviewWhenPrOpen: false,
    });
    expect(reloadFromMain).toHaveBeenCalledTimes(1);
    expect(provider.update).not.toHaveBeenCalled();
  });

  it('writes cloud patch when githubPr view changes', async () => {
    const update = vi.fn().mockImplementation(async (_id: string, patch: unknown) => ({
      ...baseTask(),
      ...(patch as object),
    }));
    const provider: TaskProvider = {
      subscribe: vi.fn().mockReturnValue(vi.fn()),
      create: vi.fn(),
      update,
      delete: vi.fn(),
    };
    await applyGithubPrRefreshFromRenderer({
      projectKind: 'cloud',
      taskId: 't1',
      live: baseTask({ githubPr: undefined }),
      snapshot: [baseTask()],
      result: {
        ok: true,
        githubPr: { url: 'https://github.com/o/r/pull/2', state: 'open' },
        persisted: false,
      },
      provider,
      autoMarkDoneWhenPrMerged: false,
      autoMoveToReviewWhenPrOpen: false,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toMatchObject({
      githubPr: { url: 'https://github.com/o/r/pull/2', state: 'open' },
    });
  });
});
