import { describe, expect, it } from 'vitest';
import { agentSupportsGracefulQuitCapture } from './gracefulAgentExit';

describe('agentSupportsGracefulQuitCapture', () => {
  it('includes cursor, claude-code, and codex', () => {
    expect(agentSupportsGracefulQuitCapture('cursor')).toBe(true);
    expect(agentSupportsGracefulQuitCapture('claude-code')).toBe(true);
    expect(agentSupportsGracefulQuitCapture('codex')).toBe(true);
  });
});
