import { describe, expect, it } from 'vitest';
import { TaskAgentSessionRecordStore } from './taskAgentSessionRecords';

describe('TaskAgentSessionRecordStore', () => {
  it('getResumeConversationId prefers latest row', async () => {
    const dir = '/tmp/flux-test-project';
    const store = new TaskAgentSessionRecordStore({ getProjectDir: () => dir });
    store._testImportRecords([
      {
        fluxxSessionId: 's1',
        taskId: 't1',
        projectId: 'p1',
        agent: 'cursor',
        worktreePath: '/wt',
        fluxxWorkBranch: 'fluxx/task',
        startedAt: '2020-01-01T00:00:00.000Z',
        endedAt: '2020-01-01T01:00:00.000Z',
        endedReason: 'agent-exit-ok',
        agentConversationId: 'old-id',
      },
      {
        fluxxSessionId: 's2',
        taskId: 't1',
        projectId: 'p1',
        agent: 'cursor',
        worktreePath: '/wt',
        fluxxWorkBranch: 'fluxx/task',
        startedAt: '2020-01-02T00:00:00.000Z',
        endedAt: '2020-01-02T01:00:00.000Z',
        endedReason: 'app-quit',
        agentConversationId: 'new-id',
      },
    ]);
    await expect(store.getResumeConversationId('t1', 'cursor')).resolves.toBe('new-id');
  });

  it('workspace-deleted rows are not cold-resumable', async () => {
    const store = new TaskAgentSessionRecordStore({ getProjectDir: () => '/tmp/x' });
    store._testImportRecords([
      {
        fluxxSessionId: 'sid',
        taskId: 't1',
        projectId: 'p1',
        agent: 'cursor',
        worktreePath: '/wt',
        fluxxWorkBranch: 'b',
        startedAt: '2020-01-01T00:00:00.000Z',
        endedAt: '2020-01-01T01:00:00.000Z',
        endedReason: 'agent-exit-ok',
      },
    ]);
    await store.markWorkspaceDeletedForFluxxSession('sid');
    await expect(store.getColdResumeSessionView('t1', 'p1', async () => true)).resolves.toBeNull();
  });

  it('listColdResumeTaskSessions returns interrupted rows after app-quit', async () => {
    const store = new TaskAgentSessionRecordStore({ getProjectDir: () => '/tmp/x' });
    store._testImportRecords([
      {
        fluxxSessionId: 'cold-a',
        taskId: 't1',
        projectId: 'p1',
        agent: 'cursor',
        worktreePath: '/wt-a',
        fluxxWorkBranch: 'b',
        startedAt: '2020-01-01T00:00:00.000Z',
        endedAt: '2020-01-01T01:00:00.000Z',
        endedReason: 'app-quit',
      },
      {
        fluxxSessionId: 'archived',
        taskId: 't2',
        projectId: 'p1',
        agent: 'cursor',
        worktreePath: '/wt-b',
        fluxxWorkBranch: 'b',
        startedAt: '2020-01-02T00:00:00.000Z',
        endedAt: '2020-01-02T01:00:00.000Z',
        endedReason: 'user-archived',
      },
    ]);
    const listed = await store.listColdResumeTaskSessions('p1', async () => true);
    expect(listed.map((s) => s.id)).toEqual(['cold-a']);
  });

  it('open rows without endedAt are cold-resumable after force quit', async () => {
    const store = new TaskAgentSessionRecordStore({ getProjectDir: () => '/tmp/x' });
    store._testImportRecords([
      {
        fluxxSessionId: 'open-sid',
        taskId: 't1',
        projectId: 'p1',
        agent: 'cursor',
        worktreePath: '/wt',
        fluxxWorkBranch: 'b',
        startedAt: '2020-01-01T00:00:00.000Z',
      },
    ]);
    const listed = await store.listColdResumeTaskSessions('p1', async () => true);
    expect(listed.map((s) => s.id)).toEqual(['open-sid']);
    expect(listed[0]?.status).toBe('interrupted');
  });

  it('listColdResumeTaskSessions includes tmux-missing ended rows', async () => {
    const store = new TaskAgentSessionRecordStore({ getProjectDir: () => '/tmp/x' });
    store._testImportRecords([
      {
        fluxxSessionId: 's-tmux',
        taskId: 't1',
        projectId: 'p1',
        agent: 'claude-code',
        worktreePath: '/wt',
        fluxxWorkBranch: 'b',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-02T00:00:00.000Z',
        endedReason: 'tmux-missing',
      },
    ]);
    const listed = await store.listColdResumeTaskSessions('p1', async () => true);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe('interrupted');
    expect(listed[0]?.id).toBe('s-tmux');
  });

  it('markSessionEnded with user-archived prevents future cold restore', async () => {
    const store = new TaskAgentSessionRecordStore({ getProjectDir: () => '/tmp/x' });
    store._testImportRecords([
      {
        fluxxSessionId: 'sid',
        taskId: 't1',
        projectId: 'p1',
        agent: 'cursor',
        worktreePath: '/wt',
        fluxxWorkBranch: 'b',
        startedAt: '2020-01-01T00:00:00.000Z',
        endedAt: '2020-01-01T01:00:00.000Z',
        endedReason: 'app-quit',
      },
    ]);
    await store.markSessionEnded(
      {
        id: 'sid',
        status: 'stopped',
        startedAt: '2020-01-01T00:00:00.000Z',
        stoppedAt: '2020-01-02T00:00:00.000Z',
      },
      { reason: 'user-archived' },
    );
    await expect(
      store.getColdResumeSessionById('p1', 'sid', async () => true),
    ).resolves.toBeNull();
    await expect(store.listColdResumeTaskSessions('p1', async () => true)).resolves.toEqual([]);
  });
});
