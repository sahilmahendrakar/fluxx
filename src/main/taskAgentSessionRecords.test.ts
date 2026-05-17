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
});
