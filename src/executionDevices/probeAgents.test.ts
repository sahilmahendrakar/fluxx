import { describe, expect, it } from 'vitest';
import {
  buildAvailableProbeMessage,
  detectedAgentCommands,
  probeAgentWarningMessage,
  probeHasNoDetectedAgents,
} from './probeAgents';

describe('probeAgents', () => {
  it('lists only found agent commands', () => {
    expect(
      detectedAgentCommands({
        agents: [
          { command: 'claude', found: true },
          { command: 'agent', found: false },
          { command: 'codex', found: true },
        ],
      }),
    ).toEqual(['claude', 'codex']);
  });

  it('builds available message with detected agents', () => {
    expect(
      buildAvailableProbeMessage({
        os: 'Linux',
        arch: 'arm64',
        agents: [{ command: 'claude', found: true }],
      }),
    ).toBe('Available · Linux (arm64) · agents: claude');
  });

  it('builds available message when no agents are detected', () => {
    expect(
      buildAvailableProbeMessage({
        os: 'Darwin',
        agents: [
          { command: 'claude', found: false },
          { command: 'agent', found: false },
        ],
      }),
    ).toBe('Available · Darwin · no agent CLIs detected');
  });

  it('warns only when probe is available and every agent check failed', () => {
    expect(
      probeHasNoDetectedAgents({
        status: 'available',
        checkedAt: 't',
        capabilities: {
          agents: [
            { command: 'claude', found: false },
            { command: 'agent', found: false },
          ],
        },
      }),
    ).toBe(true);
    expect(
      probeAgentWarningMessage({
        status: 'available',
        checkedAt: 't',
        capabilities: {
          agents: [{ command: 'claude', found: true }],
        },
      }),
    ).toBeNull();
  });
});
