import { describe, expect, it } from 'vitest';
import { parseFluxCliArgs } from './parseArgs';

describe('parseFluxCliArgs', () => {
  it('parses project info --json', () => {
    const r = parseFluxCliArgs(['project', 'info', '--json']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command).toEqual({ kind: 'project', action: 'info', json: true });
    }
  });

  it('parses tasks list with exclude-status', () => {
    const r = parseFluxCliArgs(['tasks', 'list', '--exclude-status', 'done', '--json']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'tasks' && r.command.action === 'list') {
      expect(r.command.excludeStatuses).toEqual(['done']);
    }
  });

  it('requires --confirm for tasks delete', () => {
    const r = parseFluxCliArgs(['tasks', 'delete', '--id', 't1']);
    expect(r.ok).toBe(false);
  });

  it('parses task create repo, branch, labels, and dependencies', () => {
    const r = parseFluxCliArgs([
      'tasks',
      'create',
      '--json',
      '--title',
      'Implement auth',
      '--repo-id',
      'web',
      '--feature-branch',
      'feature/auth',
      '--create-source-branch-if-missing=true',
      '--label',
      'auth',
      '--labels',
      'frontend, security',
      '--depends-on-task-id',
      'task-a',
      '--blocked-by',
      'task-b, task-c',
    ]);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'tasks' && r.command.action === 'create') {
      expect(r.command.payload).toMatchObject({
        title: 'Implement auth',
        repoId: 'web',
        sourceBranch: 'feature/auth',
        createSourceBranchIfMissing: true,
        labels: ['auth', 'frontend', 'security'],
        blockedByTaskIds: ['task-a', 'task-b', 'task-c'],
      });
    }
  });

  it('parses task update aliases and clear operations', () => {
    const r = parseFluxCliArgs([
      'tasks',
      'update',
      '--id',
      'task-1',
      '--repo',
      'api',
      '--branch',
      'feature/api',
      '--clear-labels',
      '--clear-dependencies',
    ]);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'tasks' && r.command.action === 'update') {
      expect(r.command.payload).toMatchObject({
        id: 'task-1',
        repoId: 'api',
        sourceBranch: 'feature/api',
        labels: [],
        blockedByTaskIds: [],
      });
    }
  });

  it('parses task create and update attach-doc flags', () => {
    const create = parseFluxCliArgs([
      'tasks',
      'create',
      '--title',
      'Ship',
      '--attach-doc',
      'docs/plan.md',
      '--attach-docs',
      'notes/extra.md',
    ]);
    expect(create.ok).toBe(true);
    if (create.ok && create.command.kind === 'tasks' && create.command.action === 'create') {
      expect(create.command.payload.attachedPlanningDocs).toEqual([
        { relativePath: 'docs/plan.md' },
        { relativePath: 'notes/extra.md' },
      ]);
    }

    const update = parseFluxCliArgs([
      'tasks',
      'update',
      '--id',
      't1',
      '--attach-planning-doc',
      'docs/plan.md',
    ]);
    expect(update.ok).toBe(true);
    if (update.ok && update.command.kind === 'tasks' && update.command.action === 'update') {
      expect(update.command.payload.attachedPlanningDocs).toEqual([{ relativePath: 'docs/plan.md' }]);
    }

    const cleared = parseFluxCliArgs(['tasks', 'update', '--id', 't1', '--clear-attached-docs']);
    expect(cleared.ok).toBe(true);
    if (cleared.ok && cleared.command.kind === 'tasks' && cleared.command.action === 'update') {
      expect(cleared.command.payload.attachedPlanningDocs).toBeNull();
    }
  });

  it('rejects ambiguous attach-doc and clear-attached-docs', () => {
    expect(
      parseFluxCliArgs([
        'tasks',
        'update',
        '--id',
        't1',
        '--attach-doc',
        'docs/a.md',
        '--clear-attach-docs',
      ]).ok,
    ).toBe(false);
  });

  it('rejects ambiguous label and dependency clears', () => {
    expect(
      parseFluxCliArgs(['tasks', 'update', '--id', 't1', '--label', 'x', '--clear-labels']).ok,
    ).toBe(false);
    expect(
      parseFluxCliArgs([
        'tasks',
        'update',
        '--id',
        't1',
        '--depends-on-task-id',
        'parent',
        '--clear-dependencies',
      ]).ok,
    ).toBe(false);
  });

  it('parses tasks delete with confirm', () => {
    const r = parseFluxCliArgs(['tasks', 'delete', '--id', 't1', '--confirm']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'tasks' && r.command.action === 'delete') {
      expect(r.command.id).toBe('t1');
      expect(r.command.confirm).toBe(true);
    }
  });
});
