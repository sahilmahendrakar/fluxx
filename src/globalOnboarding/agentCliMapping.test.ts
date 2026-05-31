import { describe, expect, it } from 'vitest';
import {
  agentInstallLinkLabel,
  agentProbeResult,
  AGENT_INSTALL_URLS,
  cliCommandLabel,
  cliProbeStatusLabel,
  GITHUB_CLI_DOWNLOAD_URL,
  GLOBAL_ONBOARDING_AGENT_CLI,
  isAgentCliInstalled,
  probeResultByCommand,
} from './agentCliMapping';
import type { GlobalOnboardingCliProbeResult } from './types';

const sampleResults: GlobalOnboardingCliProbeResult[] = [
  { command: 'claude', status: 'found', path: '/bin/claude' },
  { command: 'agent', status: 'missing' },
  { command: 'codex', status: 'timeout', message: 'slow' },
  { command: 'gh', status: 'error', message: 'boom' },
];

describe('agentCliMapping', () => {
  it('maps agents to CLI commands and probe rows', () => {
    expect(GLOBAL_ONBOARDING_AGENT_CLI['claude-code']).toBe('claude');
    expect(agentProbeResult(sampleResults, 'cursor')).toEqual({
      command: 'agent',
      status: 'missing',
    });
    expect(probeResultByCommand(sampleResults, 'gh')).toEqual({
      command: 'gh',
      status: 'error',
      message: 'boom',
    });
  });

  it('detects installed agents and install link metadata', () => {
    expect(isAgentCliInstalled({ command: 'claude', status: 'found', path: '/x' })).toBe(true);
    expect(isAgentCliInstalled({ command: 'codex', status: 'missing' })).toBe(false);
    expect(agentInstallLinkLabel('codex')).toBe('Get Codex');
    expect(AGENT_INSTALL_URLS.codex).toMatch(/^https:\/\//);
  });

  it('labels probe statuses for the dialog', () => {
    expect(cliProbeStatusLabel('found')).toBe('Detected');
    expect(cliProbeStatusLabel('missing')).toBe('Not installed');
    expect(cliProbeStatusLabel('error')).toBe('Check failed');
    expect(cliProbeStatusLabel('timeout')).toBe('Timed out');
    expect(cliCommandLabel('gh')).toBe('gh');
    expect(GITHUB_CLI_DOWNLOAD_URL).toBe('https://cli.github.com/');
  });
});
