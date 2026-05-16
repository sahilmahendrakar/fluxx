import { describe, expect, it } from 'vitest';
import { planningSpawnSpec } from './agentSpawn';

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
