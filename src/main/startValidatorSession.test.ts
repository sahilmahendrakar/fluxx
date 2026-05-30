import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session, Task } from '../types';
import { saveValidationPacksProjectConfig } from '../validationPacks/projectConfig';
import { ValidationRunStore } from './ValidationRunStore';
import { startValidatorSession } from './startValidatorSession';
import type { TerminalBackend } from './terminalBackend/TerminalBackend';

describe('startValidatorSession', () => {
  let tmp = '';
  let worktree = '';

  afterEach(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
    if (worktree) await fs.rm(worktree, { recursive: true, force: true });
    tmp = '';
    worktree = '';
  });

  const task: Task = {
    id: 'task-1',
    title: 'Review task',
    description: 'Validate me',
    status: 'validation',
    agent: 'cursor',
    projectId: 'proj-1',
    orderKey: 'a',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('rejects tasks not in validation', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-start-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: task.id,
      projectId: 'proj-1',
      validatorAgent: 'cursor',
    });
    const result = await startValidatorSession(
      {
        validationRunStore: store,
        terminalBackend: {} as TerminalBackend,
        listTerminalSessions: async () => [],
        getProjectDir: () => tmp,
        resolveWorktreePath: async () => null,
        buildSpawnContext: async () => ({}),
      },
      { task: { ...task, status: 'in-progress' }, runId: run.id },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TASK_NOT_IN_VALIDATION');
  });

  it('marks run running and spawns validator in existing worktree', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-start-'));
    worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-wt-'));
    await fs.writeFile(path.join(worktree, 'marker.txt'), 'x', 'utf8');
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: task.id,
      projectId: 'proj-1',
      validatorAgent: 'cursor',
    });

    const session: Session = {
      id: 'validator-sess-1',
      taskId: task.id,
      projectId: 'proj-1',
      worktreePath: worktree,
      branch: 'fluxx/task-1',
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const createSession = vi.fn(async () => session);
    const terminalBackend = { createSession } as unknown as TerminalBackend;

    const result = await startValidatorSession(
      {
        validationRunStore: store,
        terminalBackend,
        listTerminalSessions: async () => [],
        getProjectDir: () => tmp,
        resolveWorktreePath: async () => ({
          worktreePath: worktree,
          branch: 'fluxx/task-1',
        }),
        buildSpawnContext: async () => ({}),
      },
      { task, runId: run.id },
    );

    expect(result.ok).toBe(true);
    expect(createSession).toHaveBeenCalledOnce();
    if (result.ok) {
      expect(result.run.status).toBe('running');
      expect(result.run.validatorSessionId).toBe('validator-sess-1');
      expect(result.run.worktreeCwd).toBe(worktree);
      const prompt = await fs.readFile(
        path.join(result.run.artifactDir, 'validator-prompt.md'),
        'utf8',
      );
      expect(prompt).toContain('Review task');
      const guardrails = JSON.parse(
        await fs.readFile(path.join(result.run.artifactDir, 'guardrails.json'), 'utf8'),
      );
      expect(guardrails.preValidationGitStatus).toBeDefined();
    }
  });

  it('starts validation when project config is empty', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-start-empty-'));
    worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-wt-empty-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: task.id,
      projectId: 'proj-1',
      validatorAgent: 'cursor',
    });

    const session: Session = {
      id: 'validator-sess-empty',
      taskId: task.id,
      projectId: 'proj-1',
      worktreePath: worktree,
      branch: 'fluxx/task-1',
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    const result = await startValidatorSession(
      {
        validationRunStore: store,
        terminalBackend: { createSession: vi.fn(async () => session) } as unknown as TerminalBackend,
        listTerminalSessions: async () => [],
        getProjectDir: () => tmp,
        resolveWorktreePath: async () => ({
          worktreePath: worktree,
          branch: 'fluxx/task-1',
        }),
        buildSpawnContext: async () => ({}),
      },
      { task, runId: run.id },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const prompt = await fs.readFile(
        path.join(result.run.artifactDir, 'validator-prompt.md'),
        'utf8',
      );
      expect(prompt).toContain('Infer launch from the project');
      expect(prompt).toContain('package.json');
    }
  });

  it('loads saved appendPrompt into instructions when starting validator', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-start-config-'));
    worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-wt-config-'));
    saveValidationPacksProjectConfig(tmp, 'electron-playwright', {
      launchCommand: 'pnpm start:aux',
      appendPrompt: 'Always open Settings first.',
    });

    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: task.id,
      projectId: 'proj-1',
      validatorAgent: 'cursor',
    });

    const session: Session = {
      id: 'validator-sess-config',
      taskId: task.id,
      projectId: 'proj-1',
      worktreePath: worktree,
      branch: 'fluxx/task-1',
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    const result = await startValidatorSession(
      {
        validationRunStore: store,
        terminalBackend: { createSession: vi.fn(async () => session) } as unknown as TerminalBackend,
        listTerminalSessions: async () => [],
        getProjectDir: () => tmp,
        resolveWorktreePath: async () => ({
          worktreePath: worktree,
          branch: 'fluxx/task-1',
        }),
        buildSpawnContext: async () => ({}),
      },
      { task, runId: run.id },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const instructions = await fs.readFile(
        path.join(result.run.artifactDir, 'instructions.md'),
        'utf8',
      );
      expect(instructions).toContain('Always open Settings first.');
      expect(instructions).toContain('pnpm start:aux');

      const prompt = await fs.readFile(
        path.join(result.run.artifactDir, 'validator-prompt.md'),
        'utf8',
      );
      expect(prompt).toContain('## Project validation notes');
      expect(prompt).toContain('Always open Settings first.');
      expect(prompt).toContain('pnpm start:aux');
      expect(prompt).not.toContain('Infer launch from the project');
    }
  });
});
