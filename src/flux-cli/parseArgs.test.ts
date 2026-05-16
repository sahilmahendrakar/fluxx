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

  it('parses tasks delete with confirm', () => {
    const r = parseFluxCliArgs(['tasks', 'delete', '--id', 't1', '--confirm']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'tasks' && r.command.action === 'delete') {
      expect(r.command.id).toBe('t1');
      expect(r.command.confirm).toBe(true);
    }
  });
});
