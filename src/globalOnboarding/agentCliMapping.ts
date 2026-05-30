import type { Agent } from '../types';
import type {
  CliProbeStatus,
  GlobalOnboardingCliId,
  GlobalOnboardingCliProbeResult,
} from './types';

export const GLOBAL_ONBOARDING_AGENT_CLI: Record<Agent, GlobalOnboardingCliId> = {
  'claude-code': 'claude',
  cursor: 'agent',
  codex: 'codex',
};

export const GITHUB_CLI_DOWNLOAD_URL = 'https://cli.github.com/';

export function probeResultByCommand(
  results: GlobalOnboardingCliProbeResult[],
  command: GlobalOnboardingCliId,
): GlobalOnboardingCliProbeResult | undefined {
  return results.find((result) => result.command === command);
}

export function agentProbeResult(
  results: GlobalOnboardingCliProbeResult[],
  agent: Agent,
): GlobalOnboardingCliProbeResult | undefined {
  return probeResultByCommand(results, GLOBAL_ONBOARDING_AGENT_CLI[agent]);
}

export function cliProbeStatusLabel(status: CliProbeStatus): string {
  switch (status) {
    case 'found':
      return 'Detected';
    case 'missing':
      return 'Not installed';
    case 'error':
      return 'Check failed';
    case 'timeout':
      return 'Timed out';
  }
}

export function cliCommandLabel(command: GlobalOnboardingCliId): string {
  return command;
}
