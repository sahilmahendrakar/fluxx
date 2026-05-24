import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import {
  agentNotFoundMessage,
  agentSpawnResumeSpec,
  agentSpawnSpec,
  codexSpawnArgs,
  planningSpawnResumeSpec,
  planningSpawnSpec,
} from './agentSpawn';

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

  it('cursor includes approve-mcps for MCP servers', () => {
    const { command, args } = planningSpawnSpec('cursor', '', false);
    expect(command).toBe('agent');
    expect(args).toEqual(['--model', 'auto', '--approve-mcps']);
  });

  it('passes optional initial prompt for planning agents', () => {
    expect(planningSpawnSpec('claude-code', '', false, 'init')).toEqual({
      command: 'claude',
      args: ['init'],
    });
  });

  it('cursor passes yolo when enabled', () => {
    const { args } = planningSpawnSpec('cursor', 'gpt-5', true);
    expect(args).toContain('--yolo');
    expect(args).toContain('--model');
    expect(args).toContain('gpt-5');
  });

  it('codex defaults to workspace-write sandbox', () => {
    expect(planningSpawnSpec('codex')).toEqual({
      command: 'codex',
      args: ['--sandbox', 'workspace-write'],
    });
  });

  it('codex passes model, yolo, and optional prompt', () => {
    expect(planningSpawnSpec('codex', 'gpt-5.4', true, 'plan this')).toEqual({
      command: 'codex',
      args: ['--model', 'gpt-5.4', '--yolo', 'plan this'],
    });
  });
});

describe('agentSpawnSpec codex', () => {
  it('passes composed task prompt as positional arg with default sandbox', () => {
    const { command, args } = agentSpawnSpec(
      task({ agent: 'codex', title: 'Fix bug', description: 'Details here' }),
      'Fix bug\n\nDetails here',
    );
    expect(command).toBe('codex');
    expect(args).toEqual(['--sandbox', 'workspace-write', 'Fix bug\n\nDetails here']);
  });

  it('passes model and yolo when set', () => {
    const { args } = agentSpawnSpec(
      task({ agent: 'codex', agentModel: 'gpt-5.4', agentYolo: true }),
      'do work',
    );
    expect(args).toEqual(['--model', 'gpt-5.4', '--yolo', 'do work']);
  });
});

describe('codexSpawnArgs', () => {
  it('resume without session id uses --last', () => {
    expect(codexSpawnArgs({ yolo: false, resume: {} })).toEqual([
      '--sandbox',
      'workspace-write',
      'resume',
      '--last',
    ]);
  });

  it('resume with session id omits --last', () => {
    expect(
      codexSpawnArgs({
        model: 'gpt-5.4',
        resume: { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      }),
    ).toEqual([
      '--model',
      'gpt-5.4',
      '--sandbox',
      'workspace-write',
      'resume',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    ]);
  });
});

describe('agentNotFoundMessage', () => {
  it('includes Codex install guidance', () => {
    expect(agentNotFoundMessage('codex', 'codex')).toContain('codex');
    expect(agentNotFoundMessage('codex', 'codex')).toContain('developers.openai.com/codex');
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

describe('planningSpawnResumeSpec', () => {
  it('uses bare --resume when id omitted', () => {
    const { command, args } = planningSpawnResumeSpec('claude-code', 'sonnet', true);
    expect(command).toBe('claude');
    expect(args).toEqual([
      '--model',
      'sonnet',
      '--dangerously-skip-permissions',
      '--resume',
    ]);
  });

  it('passes conversation id for Claude and Cursor', () => {
    expect(
      planningSpawnResumeSpec('claude-code', '', false, {
        agentConversationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }).args,
    ).toEqual(['--resume', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);

    const cursor = planningSpawnResumeSpec('cursor', 'gpt-5', true, {
      agentConversationId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    });
    expect(cursor.command).toBe('agent');
    expect(cursor.args).toContain('--model');
    expect(cursor.args).toContain('gpt-5');
    expect(cursor.args).toContain('--yolo');
    const i = cursor.args.indexOf('--resume');
    expect(cursor.args[i + 1]).toBe('bbbbbbbb-cccc-dddd-eeee-ffffffffffff');
  });

  it('codex resume uses subcommand with --last or session id', () => {
    expect(planningSpawnResumeSpec('codex')).toEqual({
      command: 'codex',
      args: ['--sandbox', 'workspace-write', 'resume', '--last'],
    });
    expect(
      planningSpawnResumeSpec('codex', 'gpt-5.4', true, {
        agentConversationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }),
    ).toEqual({
      command: 'codex',
      args: [
        '--model',
        'gpt-5.4',
        '--yolo',
        'resume',
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      ],
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

  it('codex resume uses subcommand with session id or --last', () => {
    expect(agentSpawnResumeSpec(task({ agent: 'codex' }))).toEqual({
      command: 'codex',
      args: ['--sandbox', 'workspace-write', 'resume', '--last'],
    });
    const { command, args } = agentSpawnResumeSpec(
      task({ agent: 'codex', agentModel: 'gpt-5.4', agentYolo: true }),
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
    expect(command).toBe('codex');
    expect(args).toEqual([
      '--model',
      'gpt-5.4',
      '--yolo',
      'resume',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    ]);
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
