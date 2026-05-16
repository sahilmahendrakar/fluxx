import {
  type Agent,
  type Task,
  claudeCodeExplicitModel,
  resolvedCursorAgentModel,
} from '../types';

/** Compose the first prompt for an agent spawn from the task row. */
export function taskInitialPrompt(task: Task): string {
  const desc = (task.description ?? '').trim();
  return desc ? `${task.title}\n\n${desc}` : task.title;
}

export type AgentSpawnTaskInput = Pick<Task, 'agent' | 'agentModel' | 'agentYolo'>;
export type AgentSpawnResumeOptions =
  | string
  | {
      agentConversationId?: string;
      mcpConfigPath?: string;
    };

export function agentSpawnSpec(
  task: AgentSpawnTaskInput,
  initialPrompt: string,
  options: { mcpConfigPath?: string } = {},
): { command: string; args: string[] } {
  if (task.agent == null) {
    throw new Error('agentSpawnSpec requires a task agent');
  }
  switch (task.agent) {
    case 'claude-code': {
      const args: string[] = [];
      const model = claudeCodeExplicitModel(task);
      if (model) {
        args.push('--model', model);
      }
      if (task.agentYolo === true) {
        args.push('--dangerously-skip-permissions');
      }
      if (options.mcpConfigPath) {
        args.push('--mcp-config', options.mcpConfigPath);
      }
      // Claude's --mcp-config is variadic, so separate it from the prompt.
      if (options.mcpConfigPath) {
        args.push('--');
      }
      args.push(initialPrompt);
      return { command: 'claude', args };
    }
    case 'codex':
      return { command: 'codex', args: [] };
    case 'cursor': {
      const model = resolvedCursorAgentModel(task);
      const args: string[] = ['--model', model, '--approve-mcps'];
      if (task.agentYolo === true) {
        args.push('--yolo');
      }
      args.push(initialPrompt);
      return { command: 'agent', args };
    }
  }
}

/**
 * Same agents as {@link agentSpawnSpec}, but resume-only argv: model / yolo
 * flags are preserved, then a single `--resume` (no initial prompt).
 */
export function agentSpawnResumeSpec(
  task: AgentSpawnTaskInput,
  options: AgentSpawnResumeOptions = {},
): { command: string; args: string[] } {
  if (task.agent == null) {
    throw new Error('agentSpawnResumeSpec requires a task agent');
  }
  const resumeId =
    typeof options === 'string'
      ? options.trim()
      : options.agentConversationId?.trim();
  const mcpConfigPath = typeof options === 'string' ? undefined : options.mcpConfigPath;
  switch (task.agent) {
    case 'claude-code': {
      const args: string[] = [];
      const model = claudeCodeExplicitModel(task);
      if (model) {
        args.push('--model', model);
      }
      if (task.agentYolo === true) {
        args.push('--dangerously-skip-permissions');
      }
      if (mcpConfigPath) {
        args.push('--mcp-config', mcpConfigPath);
      }
      if (resumeId) {
        args.push('--resume', resumeId);
      } else {
        args.push('--resume');
      }
      return { command: 'claude', args };
    }
    case 'codex':
      return { command: 'codex', args: ['--resume'] };
    case 'cursor': {
      const model = resolvedCursorAgentModel(task);
      const args: string[] = ['--model', model, '--approve-mcps'];
      if (task.agentYolo === true) {
        args.push('--yolo');
      }
      if (resumeId) {
        args.push('--resume', resumeId);
      } else {
        args.push('--resume');
      }
      return { command: 'agent', args };
    }
  }
}

/**
 * Planning PTY uses project-level agent (and optional model for Claude / Cursor).
 * Task sessions use {@link agentSpawnSpec} with the task row.
 *
 * @param agentModel — For `claude-code`, non-empty → `--model`; for `cursor`, passed to
 *   `--model` (default `auto` when blank). Ignored for `codex`.
 */
export function planningSpawnSpec(
  agent: Agent,
  mcpConfigPath: string,
  agentModel?: string,
  agentYolo?: boolean,
): { command: string; args: string[] } {
  switch (agent) {
    case 'claude-code': {
      const model = (agentModel ?? '').trim();
      const args: string[] = [];
      if (model) {
        args.push('--model', model);
      }
      if (agentYolo === true) {
        args.push('--dangerously-skip-permissions');
      }
      args.push(
        '--mcp-config',
        mcpConfigPath,
        '--append-system-prompt',
        'You are a planning assistant for a software project. Help the developer plan features, maintain documentation in this directory, and manage tasks on the Flux board using the available flux__ tools (list/create/start/update/delete tasks; get_project_info, list_repo_branches, and list_members for repo/member context; create/update accept optional blockedByTaskIds, labels, assigneeEmail, sourceBranch, createSourceBranchIfMissing, and attachedPlanningDocs with { relativePath } entries for existing planning markdown (e.g. docs/plan.md under this workspace); update also accepts unassignAssignee:true and can set attachedPlanningDocs to null or [] to clear; when assigning or reassigning a task, call list_members if needed and pass the member email as assigneeEmail; when the user names a git branch for the work, pass sourceBranch on every related task you create; use createSourceBranchIfMissing only when they want a missing branch created on first session start; when you split a comprehensive plan into implementation tasks, attach the current plan doc via attachedPlanningDocs on each derived task but keep each task description scoped to that task slice only; delete requires explicit user intent and confirm:true). Do not write application code.',
      );
      return { command: 'claude', args };
    }
    case 'codex':
      return {
        command: 'codex',
        args: [],
      };
    case 'cursor': {
      const model = (agentModel ?? '').trim() || 'auto';
      const args: string[] = ['--model', model, '--approve-mcps'];
      if (agentYolo === true) {
        args.push('--yolo');
      }
      return {
        command: 'agent',
        args,
      };
    }
  }
}

export function agentNotFoundMessage(agent: Agent, command: string): string {
  if (agent === 'claude-code') {
    return `${command} not found on PATH. Install with: npm install -g @anthropic-ai/claude-code`;
  }
  if (agent === 'cursor') {
    return `${command} not found on PATH. Install Cursor Agent CLI: https://cursor.com/docs/cli/installation`;
  }
  return `${command} not found on PATH`;
}
