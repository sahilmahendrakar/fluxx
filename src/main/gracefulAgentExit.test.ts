import { describe, expect, it } from 'vitest';
import { agentSupportsGracefulQuitCapture } from './gracefulAgentExit';

describe('agentSupportsGracefulQuitCapture', () => {
  it('includes cursor and claude-code', () => {
    expect(agentSupportsGracefulQuitCapture('cursor')).toBe(true);
    expect(agentSupportsGracefulQuitCapture('claude-code')).toBe(true);
  });

  it('excludes codex', () => {
    expect(agentSupportsGracefulQuitCapture('codex')).toBe(false);
  });
});
