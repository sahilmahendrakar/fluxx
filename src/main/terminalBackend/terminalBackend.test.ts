import { describe, expect, it, vi } from 'vitest';
import type { TerminalBackend } from './TerminalBackend';
import { createMainTerminalBackend } from './createMainTerminalBackend';
import { LocalMainProcessTerminalBackend } from './LocalMainProcessTerminalBackend';
import { RoutingTerminalBackend } from './RoutingTerminalBackend';

describe('TerminalBackend', () => {
  it('LocalMainProcessTerminalBackend satisfies TerminalBackend for callers', async () => {
    const backend: TerminalBackend = new LocalMainProcessTerminalBackend({
      deliverStreamFrame: vi.fn(),
    });
    await backend.ensureReady();
    await expect(backend.listSessions()).resolves.toEqual([]);
    await backend.teardownForAppQuit();
  });

  it('createMainTerminalBackend returns local backend without deviceStore', () => {
    expect(createMainTerminalBackend()).toBeInstanceOf(LocalMainProcessTerminalBackend);
  });

  it('createMainTerminalBackend returns routing backend with deviceStore', () => {
    const deviceStore = { getDevice: vi.fn() } as never;
    expect(createMainTerminalBackend({ deviceStore })).toBeInstanceOf(RoutingTerminalBackend);
  });
});
