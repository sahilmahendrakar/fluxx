import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { agentSpawnResumeSpec, agentSpawnSpec } from './agentSpawn';

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
