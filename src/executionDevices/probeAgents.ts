import type { DeviceProbeCapabilities, DeviceProbeResult } from '../types';

/** Agent CLI binaries probed for discovery (not required for device availability). */
export const STANDARD_AGENT_CLI_COMMANDS = ['claude', 'agent', 'codex'] as const;

export function detectedAgentCommands(
  capabilities: DeviceProbeCapabilities | undefined,
): string[] {
  if (!capabilities?.agents?.length) return [];
  return capabilities.agents.filter((a) => a.found).map((a) => a.command);
}

export function hasProbeAgentData(probe: DeviceProbeResult | undefined): boolean {
  return (probe?.capabilities?.agents?.length ?? 0) > 0;
}

export function probeHasNoDetectedAgents(probe: DeviceProbeResult | undefined): boolean {
  if (!probe || probe.status !== 'available') return false;
  if (!hasProbeAgentData(probe)) return false;
  return detectedAgentCommands(probe.capabilities).length === 0;
}

export function formatDetectedAgentsLabel(
  capabilities: DeviceProbeCapabilities | undefined,
): string | null {
  const found = detectedAgentCommands(capabilities);
  if (found.length === 0) return null;
  return found.join(', ');
}

export function buildAvailableProbeMessage(
  capabilities: DeviceProbeCapabilities | undefined,
): string {
  const osPart =
    capabilities?.os != null
      ? `${capabilities.os}${capabilities.arch ? ` (${capabilities.arch})` : ''}`
      : null;
  const agents = formatDetectedAgentsLabel(capabilities);
  if (agents) {
    return osPart ? `Available · ${osPart} · agents: ${agents}` : `Available · agents: ${agents}`;
  }
  return osPart
    ? `Available · ${osPart} · no agent CLIs detected`
    : 'Available · no agent CLIs detected';
}

export function probeAgentWarningMessage(probe: DeviceProbeResult | undefined): string | null {
  if (!probeHasNoDetectedAgents(probe)) return null;
  return 'No agent CLIs (claude, agent, codex) were found on this host. Install an agent before starting task sessions here.';
}
