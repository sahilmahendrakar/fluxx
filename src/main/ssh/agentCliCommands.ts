import type { Agent, LocalProject } from '../../types';

export function agentCommandForAgent(agent: Agent): string {
  switch (agent) {
    case 'claude-code':
      return 'claude';
    case 'cursor':
      return 'agent';
    case 'codex':
      return 'codex';
  }
}

export function agentCliCommandsForProject(
  project: Pick<LocalProject, 'defaultTaskAgent' | 'planningAgent'> | null | undefined,
): string[] {
  if (!project) {
    return ['claude', 'agent', 'codex'];
  }
  const commands = new Set<string>();
  if (project.defaultTaskAgent) {
    commands.add(agentCommandForAgent(project.defaultTaskAgent));
  }
  if (project.planningAgent) {
    commands.add(agentCommandForAgent(project.planningAgent));
  }
  if (commands.size === 0) {
    return ['claude', 'agent', 'codex'];
  }
  return [...commands];
}

export type DeviceProbeRepoRequest = {
  repoId: string;
  label?: string;
  remoteUrl: string;
};

export type DeviceProbeProjectContext = {
  repos: DeviceProbeRepoRequest[];
};
