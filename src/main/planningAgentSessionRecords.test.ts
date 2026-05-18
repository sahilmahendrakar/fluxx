import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanningAgentSessionRecordStore } from './planningAgentSessionRecords';

describe('PlanningAgentSessionRecordStore', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function tempProjectDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-planning-records-'));
    tempDirs.push(dir);
    return dir;
  }

  const baseRow = {
    fluxxSessionId: 'plan-1',
    projectId: 'proj-1',
    agent: 'cursor' as const,
    planningDir: '/tmp/proj/planning',
    startedAt: '2026-01-01T00:00:00.000Z',
  };

  it('loads valid file and persists new records', async () => {
    const dir = await tempProjectDir();
    const store = new PlanningAgentSessionRecordStore({ getProjectDir: () => dir });
    await store.recordSessionStart(baseRow);

    const raw = await fs.readFile(path.join(dir, 'planning-agent-sessions.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version: number; records: unknown[] };
    expect(parsed.version).toBe(1);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject(baseRow);
  });

  it('fails closed on missing or corrupt files', async () => {
    const dir = await tempProjectDir();
    const store = new PlanningAgentSessionRecordStore({ getProjectDir: () => dir });

    await expect(
      store.getColdResumePlanningSessionView('proj-1', async () => true),
    ).resolves.toBeNull();

    await fs.writeFile(path.join(dir, 'planning-agent-sessions.json'), '{not json', 'utf8');
    const store2 = new PlanningAgentSessionRecordStore({ getProjectDir: () => dir });
    await expect(
      store2.getColdResumePlanningSessionView('proj-1', async () => true),
    ).resolves.toBeNull();
  });

  it('mergeConversationId updates the matching row', async () => {
    const dir = await tempProjectDir();
    const store = new PlanningAgentSessionRecordStore({ getProjectDir: () => dir });
    await store.recordSessionStart(baseRow);
    await store.mergeConversationId('plan-1', 'conv-new');
    await store.markSessionEnded(
      {
        id: 'plan-1',
        status: 'stopped',
        startedAt: baseRow.startedAt,
        stoppedAt: '2026-01-01T01:00:00.000Z',
      },
      { reason: 'app-quit' },
    );

    const reloaded = new PlanningAgentSessionRecordStore({ getProjectDir: () => dir });
    const resumed = await reloaded.getColdResumePlanningSessionView('proj-1', async () => true);
    expect(resumed?.agentConversationId).toBe('conv-new');
  });

  it('excludes non-resumable end reasons from cold resume views', async () => {
    const store = new PlanningAgentSessionRecordStore({ getProjectDir: () => '/tmp/x' });
    store._testImportRecords([
      {
        ...baseRow,
        fluxxSessionId: 'archived',
        endedAt: '2026-01-01T01:00:00.000Z',
        endedReason: 'user-archived',
      },
      {
        ...baseRow,
        fluxxSessionId: 'replaced',
        endedAt: '2026-01-02T01:00:00.000Z',
        endedReason: 'replaced-by-new-session',
      },
      {
        ...baseRow,
        fluxxSessionId: 'quit',
        endedAt: '2026-01-03T01:00:00.000Z',
        endedReason: 'app-quit',
      },
    ]);

    await expect(store.getColdResumePlanningSessionView('proj-1', async () => true)).resolves.toMatchObject({
      id: 'quit',
      status: 'interrupted',
    });

    const listed = await store.listColdResumePlanningSessions('proj-1', async () => true);
    expect(listed.map((s) => s.id)).toEqual(['quit']);
  });

  it('synthesizes interrupted planning session with newest app-quit row', async () => {
    const store = new PlanningAgentSessionRecordStore({ getProjectDir: () => '/tmp/x' });
    store._testImportRecords([
      {
        ...baseRow,
        fluxxSessionId: 'older',
        endedAt: '2026-01-01T01:00:00.000Z',
        endedReason: 'agent-exit-ok',
      },
      {
        ...baseRow,
        fluxxSessionId: 'newer',
        endedAt: '2026-01-02T01:00:00.000Z',
        endedReason: 'app-quit',
        agentConversationId: 'resume-id',
      },
    ]);

    const view = await store.getColdResumePlanningSessionView('proj-1', async () => true);
    expect(view).toMatchObject({
      id: 'newer',
      status: 'interrupted',
      agentConversationId: 'resume-id',
      stoppedAt: '2026-01-02T01:00:00.000Z',
    });
  });

  it('markReplacedSessions sets replaced-by-new-session on open rows', async () => {
    const dir = await tempProjectDir();
    const store = new PlanningAgentSessionRecordStore({ getProjectDir: () => dir });
    await store.recordSessionStart(baseRow);
    await store.recordSessionStart({ ...baseRow, fluxxSessionId: 'plan-2' });
    await store.markReplacedSessions('proj-1', 'plan-3');
    await store.recordSessionStart({ ...baseRow, fluxxSessionId: 'plan-3' });

    const raw = await fs.readFile(path.join(dir, 'planning-agent-sessions.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      records: Array<{ fluxxSessionId: string; endedReason?: string }>;
    };
    const plan1 = parsed.records.find((r) => r.fluxxSessionId === 'plan-1');
    const plan2 = parsed.records.find((r) => r.fluxxSessionId === 'plan-2');
    const plan3 = parsed.records.find((r) => r.fluxxSessionId === 'plan-3');
    expect(plan1?.endedReason).toBe('replaced-by-new-session');
    expect(plan2?.endedReason).toBe('replaced-by-new-session');
    expect(plan3?.endedReason).toBeUndefined();
  });

  it('skips synthetic rows when planning dir is missing', async () => {
    const store = new PlanningAgentSessionRecordStore({ getProjectDir: () => '/tmp/x' });
    store._testImportRecords([
      {
        ...baseRow,
        endedAt: '2026-01-01T01:00:00.000Z',
        endedReason: 'app-quit',
      },
    ]);
    await expect(store.getColdResumePlanningSessionView('proj-1', async () => false)).resolves.toBeNull();
  });

  it('excludes live session ids from synthetic list', async () => {
    const store = new PlanningAgentSessionRecordStore({ getProjectDir: () => '/tmp/x' });
    store._testImportRecords([
      {
        ...baseRow,
        endedAt: '2026-01-01T01:00:00.000Z',
        endedReason: 'app-quit',
      },
    ]);
    const listed = await store.listColdResumePlanningSessions('proj-1', async () => true, {
      excludeFluxxSessionIds: new Set(['plan-1']),
    });
    expect(listed).toEqual([]);
  });
});
