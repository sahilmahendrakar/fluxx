import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { GlobalOnboardingCliId } from '../globalOnboarding/types';
import {
  GLOBAL_ONBOARDING_CLI_COMMANDS,
  probeAllGlobalOnboardingClis,
  probeGlobalOnboardingCli,
  type CliProbeRunner,
} from './globalOnboardingCliProbe';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

function stubRunner(
  outcomes: Partial<Record<GlobalOnboardingCliId, import('../globalOnboarding/types').GlobalOnboardingCliProbeResult>>,
): CliProbeRunner {
  return async (command) => {
    const hit = outcomes[command];
    if (hit) return hit;
    return { command, status: 'missing' };
  };
}

describe('globalOnboardingCliProbe', () => {
  it('probes all standard commands', async () => {
    const results = await probeAllGlobalOnboardingClis(
      100,
      stubRunner({
        claude: { command: 'claude', status: 'found', path: '/usr/local/bin/claude' },
        agent: { command: 'agent', status: 'missing' },
        codex: { command: 'codex', status: 'timeout', message: 'slow' },
        gh: { command: 'gh', status: 'error', message: 'boom' },
      }),
    );
    expect(results.map((r) => r.command)).toEqual([...GLOBAL_ONBOARDING_CLI_COMMANDS]);
    expect(results.find((r) => r.command === 'claude')?.status).toBe('found');
    expect(results.find((r) => r.command === 'agent')?.status).toBe('missing');
    expect(results.find((r) => r.command === 'codex')?.status).toBe('timeout');
    expect(results.find((r) => r.command === 'gh')?.status).toBe('error');
  });

  it('never throws when the runner resolves missing', async () => {
    await expect(
      probeGlobalOnboardingCli('gh', 50, async () => ({ command: 'gh', status: 'missing' })),
    ).resolves.toEqual({ command: 'gh', status: 'missing' });
  });

  it('maps spawn close/error outcomes for the default runner', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = vi.mocked(spawn);

    const makeStream = () => {
      const stream = new EventEmitter() as EventEmitter & { setEncoding: () => void };
      stream.setEncoding = vi.fn();
      return stream;
    };
    const foundChild = Object.assign(new EventEmitter(), {
      stdout: makeStream(),
      stderr: makeStream(),
      kill: vi.fn(),
    });
    spawnMock.mockImplementationOnce(() => foundChild as never);
    const foundPromise = probeGlobalOnboardingCli('claude', 500);
    foundChild.stdout.emit('data', '/opt/homebrew/bin/claude\n');
    foundChild.emit('close', 0);
    await expect(foundPromise).resolves.toEqual({
      command: 'claude',
      status: 'found',
      path: '/opt/homebrew/bin/claude',
    });

    const missingChild = Object.assign(new EventEmitter(), {
      stdout: makeStream(),
      stderr: makeStream(),
      kill: vi.fn(),
    });
    spawnMock.mockImplementationOnce(() => missingChild as never);
    const missingPromise = probeGlobalOnboardingCli('gh', 500);
    missingChild.emit('close', 1);
    await expect(missingPromise).resolves.toEqual({ command: 'gh', status: 'missing' });

    const errorChild = Object.assign(new EventEmitter(), {
      stdout: makeStream(),
      stderr: makeStream(),
      kill: vi.fn(),
    });
    spawnMock.mockImplementationOnce(() => errorChild as never);
    const errorPromise = probeGlobalOnboardingCli('agent', 500);
    const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    errorChild.emit('error', err);
    await expect(errorPromise).resolves.toMatchObject({
      command: 'agent',
      status: 'missing',
    });
  });
});
