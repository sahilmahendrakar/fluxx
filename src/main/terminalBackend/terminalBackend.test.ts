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

  it('createMainTerminalBackend defaults to local when env unset', () => {
    const prev = process.env.FLUX_TERMINAL_BACKEND;
    try {
      delete process.env.FLUX_TERMINAL_BACKEND;
      expect(createMainTerminalBackend()).toBeInstanceOf(LocalMainProcessTerminalBackend);
    } finally {
      if (prev === undefined) delete process.env.FLUX_TERMINAL_BACKEND;
      else process.env.FLUX_TERMINAL_BACKEND = prev;
    }
  });
});
