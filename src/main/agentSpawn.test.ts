import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { agentSpawnResumeSpec, agentSpawnSpec, planningSpawnSpec } from './agentSpawn';

function task(overrides: Pick<Task, 'agent'> & Partial<Task>): Task {
  return {
    id: 't1',
    projectId: 'p1',
    title: 'Task',
    status: 'backlog',
    orderKey: 'a',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  } as Task;
}

describe('planningSpawnSpec', () => {
  it('claude spawns without mcp-config or append-system-prompt', () => {
    const { command, args } = planningSpawnSpec('claude-code', 'sonnet', true);
    expect(command).toBe('claude');
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--mcp-config');
    expect(args).not.toContain('--append-system-prompt');
  });

  it('cursor omits approve-mcps and mcp wiring', () => {
    const { command, args } = planningSpawnSpec('cursor', '', false);
    expect(command).toBe('agent');
    expect(args).toEqual(['--model', 'auto']);
    expect(args).not.toContain('--approve-mcps');
  });

  it('cursor passes yolo when enabled', () => {
    const { args } = planningSpawnSpec('cursor', 'gpt-5', true);
    expect(args).toContain('--yolo');
    expect(args).toContain('--model');
    expect(args).toContain('gpt-5');
  });

  it('codex spawns with empty args', () => {
    expect(planningSpawnSpec('codex')).toEqual({ command: 'codex', args: [] });
  });
});

describe('agentSpawnSpec MCP args', () => {
  it('passes MCP config to Claude task sessions before the prompt', () => {
    expect(
      agentSpawnSpec(task({ agent: 'claude-code' }), 'do work', {
        mcpConfigPath: '/tmp/flux/mcp.json',
      }),
    ).toEqual({
      command: 'claude',
      args: ['--mcp-config', '/tmp/flux/mcp.json', '--', 'do work'],
    });
  });

  it('passes MCP config to Claude resume sessions before --resume', () => {
    expect(
      agentSpawnResumeSpec(task({ agent: 'claude-code' }), {
        mcpConfigPath: '/tmp/flux/mcp.json',
      }),
    ).toEqual({
      command: 'claude',
      args: ['--mcp-config', '/tmp/flux/mcp.json', '--resume'],
    });
  });

  it('auto-approves MCP servers for Cursor task sessions', () => {
    expect(agentSpawnSpec(task({ agent: 'cursor' }), 'do work')).toEqual({
      command: 'agent',
      args: ['--model', 'auto', '--approve-mcps', 'do work'],
    });
  });

  it('auto-approves MCP servers for Cursor resume sessions', () => {
    expect(agentSpawnResumeSpec(task({ agent: 'cursor' }))).toEqual({
      command: 'agent',
      args: ['--model', 'auto', '--approve-mcps', '--resume'],
    });
  });
});

describe('agentSpawnResumeSpec conversation ids', () => {
  it('uses bare --resume when id omitted', () => {
    const { command, args } = agentSpawnResumeSpec(task({ agent: 'claude-code' }));
    expect(command).toBe('claude');
    expect(args[args.length - 1]).toBe('--resume');
    expect(args).not.toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('passes conversation id for Claude', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const { command, args } = agentSpawnResumeSpec(task({ agent: 'claude-code' }), id);
    expect(command).toBe('claude');
    expect(args).toContain('--resume');
    const i = args.indexOf('--resume');
    expect(args[i + 1]).toBe(id);
  });

  it('passes MCP config and conversation id for Claude', () => {
    const { command, args } = agentSpawnResumeSpec(task({ agent: 'claude-code' }), {
      agentConversationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      mcpConfigPath: '/tmp/flux/mcp.json',
    });
    expect(command).toBe('claude');
    expect(args).toEqual([
      '--mcp-config',
      '/tmp/flux/mcp.json',
      '--resume',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    ]);
  });

  it('ignores id for codex', () => {
    const { command, args } = agentSpawnResumeSpec(
      task({ agent: 'codex' }),
      'should-not-appear',
    );
    expect(command).toBe('codex');
    expect(args).toEqual(['--resume']);
  });

  it('passes conversation id for Cursor', () => {
    const { command, args } = agentSpawnResumeSpec(
      task({ agent: 'cursor' }),
      'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    );
    expect(command).toBe('agent');
    const i = args.indexOf('--resume');
    expect(args[i + 1]).toBe('bbbbbbbb-cccc-dddd-eeee-ffffffffffff');
  });
});
