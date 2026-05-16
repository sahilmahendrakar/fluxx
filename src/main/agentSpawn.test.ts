import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { agentSpawnResumeSpec } from './agentSpawn';

const baseTask = {
  agent: 'claude-code' as const,
  agentModel: '',
  agentYolo: false,
} satisfies Pick<Task, 'agent' | 'agentModel' | 'agentYolo'>;

describe('agentSpawnResumeSpec', () => {
  it('uses bare --resume when id omitted', () => {
    const { command, args } = agentSpawnResumeSpec(baseTask);
    expect(command).toBe('claude');
    expect(args[args.length - 1]).toBe('--resume');
    expect(args).not.toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('passes conversation id for Claude', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const { command, args } = agentSpawnResumeSpec(baseTask, id);
    expect(command).toBe('claude');
    expect(args).toContain('--resume');
    const i = args.indexOf('--resume');
    expect(args[i + 1]).toBe(id);
  });

  it('ignores id for codex', () => {
    const { command, args } = agentSpawnResumeSpec(
      { agent: 'codex', agentModel: '', agentYolo: false },
      'should-not-appear',
    );
    expect(command).toBe('codex');
    expect(args).toEqual(['--resume']);
  });

  it('passes conversation id for Cursor', () => {
    const { command, args } = agentSpawnResumeSpec(
      { agent: 'cursor', agentModel: '', agentYolo: false },
      'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    );
    expect(command).toBe('agent');
    const i = args.indexOf('--resume');
    expect(args[i + 1]).toBe('bbbbbbbb-cccc-dddd-eeee-ffffffffffff');
  });
});
