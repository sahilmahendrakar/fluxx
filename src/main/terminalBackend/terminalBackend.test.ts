import { describe, expect, it, vi } from 'vitest';
import type { TerminalBackend } from './TerminalBackend';
import { createMainTerminalBackend } from './createMainTerminalBackend';
import { LocalMainProcessTerminalBackend } from './LocalMainProcessTerminalBackend';

describe('TerminalBackend', () => {
  it('LocalMainProcessTerminalBackend satisfies TerminalBackend for callers', async () => {
    const backend: TerminalBackend = new LocalMainProcessTerminalBackend({
      deliverStreamFrame: vi.fn(),
    });
    await backend.ensureReady();
    await expect(backend.listSessions()).resolves.toEqual([]);
    await backend.teardownForAppQuit();
  });

  it('createMainTerminalBackend returns local main-process backend', () => {
    expect(createMainTerminalBackend()).toBeInstanceOf(LocalMainProcessTerminalBackend);
  });
});
