import { describe, expect, it } from 'vitest';
import { REQUIRED_DAEMON_CAPABILITIES } from './protocol';
import { DaemonCore } from './DaemonCore';

describe('daemon capabilities', () => {
  it('getCapabilities includes all required capabilities', () => {
    const daemon = new DaemonCore(() => undefined);
    const caps = daemon.getCapabilities();
    for (const required of REQUIRED_DAEMON_CAPABILITIES) {
      expect(caps.methods).toContain(required);
    }
  });

  it('getCapabilities includes the capabilities method itself', () => {
    const daemon = new DaemonCore(() => undefined);
    const caps = daemon.getCapabilities();
    expect(caps.methods).toContain('capabilities');
  });

  it('PROTOCOL_VERSION is 4', async () => {
    const { PROTOCOL_VERSION } = await import('./protocol');
    expect(PROTOCOL_VERSION).toBe(4);
  });
});
