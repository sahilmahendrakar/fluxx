import { describe, expect, it, vi } from 'vitest';
import type { PlanningSession, Session } from '../types';
import type { TerminalBackend } from './terminalBackend/TerminalBackend';
import { OverseerBindingStore } from './overseerBindingStore';
import {
  injectFluxBracketedPrompt,
  resolveOverseerPlanningSession,
  resolveRunningTaskSessionForPromptInjection,
} from './fluxSessionPromptInjection';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function mockBackend(): TerminalBackend & {
  taskWrites: string[];
  planningWrites: string[];
} {
  const taskWrites: string[] = [];
  const planningWrites: string[] = [];
  const backend = {
    ensureReady: vi.fn(async () => {}),
    setSessionLifecycleHooks: vi.fn(),
    startSilenceSnapshotPolling: vi.fn(),
    onMainProcessBeforeQuit: vi.fn(),
    shouldConfirmAppQuit: vi.fn(async () => false),
    teardownForAppQuit: vi.fn(async () => {}),
    createSession: vi.fn(),
    listSessions: vi.fn(async () => []),
    getSessionSilenceStates: vi.fn(async () => []),
    attachSession: vi.fn(),
    stopSession: vi.fn(),
    writeSession: vi.fn((id: string, data: string) => {
      taskWrites.push(data);
    }),
    writeSessionAwait: vi.fn(async (_id: string, data: string) => {
      taskWrites.push(data);
    }),
    writeSessionAfterOutputText: vi.fn(),
    resizeSession: vi.fn(),
    createShell: vi.fn(),
    listShells: vi.fn(),
    attachShell: vi.fn(),
    writeShell: vi.fn(),
    resizeShell: vi.fn(),
    closeShell: vi.fn(),
    closeShellsForSession: vi.fn(),
    startPlanning: vi.fn(),
    listPlanning: vi.fn(async () => []),
    getPlanning: vi.fn(),
    attachPlanning: vi.fn(),
    writePlanning: vi.fn((_id: string, data: string) => {
      planningWrites.push(data);
    }),
    writePlanningAwait: vi.fn(async (_id: string, data: string) => {
      planningWrites.push(data);
    }),
    resizePlanning: vi.fn(),
    stopPlanning: vi.fn(),
    taskWrites,
    planningWrites,
  } as unknown as TerminalBackend & { taskWrites: string[]; planningWrites: string[] };
  return backend;
}

describe('injectFluxBracketedPrompt', () => {
  it('writes bracketed paste then submit to task sessions', async () => {
    const backend = mockBackend();
    const onTaskSubmit = vi.fn();
    await injectFluxBracketedPrompt(backend, 'task', 'sess-1', 'hello\nworld', {
      onTaskSubmit,
    });
    expect(backend.taskWrites).toHaveLength(2);
    expect(backend.taskWrites[0]).toContain('\x1b[200~hello\nworld\x1b[201~');
    expect(backend.taskWrites[1]).toBe('\r');
    expect(onTaskSubmit).toHaveBeenCalledWith('sess-1');
  });

  it('writes bracketed paste then submit to planning sessions', async () => {
    const backend = mockBackend();
    await injectFluxBracketedPrompt(backend, 'planning', 'plan-1', 'review me');
    expect(backend.planningWrites).toHaveLength(2);
    expect(backend.planningWrites[0]).toContain('review me');
    expect(backend.planningWrites[1]).toBe('\r');
  });
});

describe('resolveRunningTaskSessionForPromptInjection', () => {
  it('returns NO_AGENT_SESSION when no session matches', async () => {
    const r = await resolveRunningTaskSessionForPromptInjection(async () => [], 't1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_AGENT_SESSION');
  });

  it('returns running session id when found', async () => {
    const sessions: Session[] = [
      {
        id: 's1',
        taskId: 't1',
        status: 'running',
        worktreePath: '/wt',
        branch: 'fluxx/t1',
        agent: 'cursor-agent',
        startedAt: new Date().toISOString(),
      },
    ];
    const r = await resolveRunningTaskSessionForPromptInjection(async () => sessions, 't1');
    expect(r).toEqual({ ok: true, sessionId: 's1', session: sessions[0] });
  });
});

describe('resolveOverseerPlanningSession', () => {
  it('fails clearly when binding is missing', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-overseer-resolve-'));
    try {
      const store = new OverseerBindingStore(() => tmpDir);
      const r = await resolveOverseerPlanningSession(store, async () => [], 'p1', 'repo-a', 'feat/x');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('OVERSEER_BINDING_NOT_FOUND');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails when bound planning session is not running', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-overseer-resolve-'));
    try {
      const store = new OverseerBindingStore(() => tmpDir);
      await store.register({
        projectId: 'p1',
        repoId: 'repo-a',
        sourceBranch: 'feat/x',
        planningSessionId: 'plan-1',
      });
      const planning: PlanningSession[] = [
        {
          id: 'plan-1',
          projectId: 'p1',
          agent: 'cursor-agent',
          planningDir: '/plan',
          status: 'stopped',
          startedAt: new Date().toISOString(),
        },
      ];
      const r = await resolveOverseerPlanningSession(
        store,
        async () => planning,
        'p1',
        'repo-a',
        'feat/x',
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('PLANNING_SESSION_NOT_RUNNING');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
