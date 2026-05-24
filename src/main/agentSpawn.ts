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

export type CodexSpawnResume = {
  sessionId?: string;
};

export type CodexSpawnInput = {
  prompt?: string;
  model?: string;
  yolo?: boolean;
  resume?: CodexSpawnResume;
};

/** Shared argv for `codex` task/planning spawn and `codex resume` cold restore. */
export function codexSpawnArgs(input: CodexSpawnInput): string[] {
  const args: string[] = [];
  const model = (input.model ?? '').trim();
  if (model) {
    args.push('--model', model);
  }
  if (input.yolo === true) {
    args.push('--yolo');
  } else {
    args.push('--sandbox', 'workspace-write');
  }
  if (input.resume) {
    args.push('resume');
    const sessionId = (input.resume.sessionId ?? '').trim();
    if (sessionId) {
      args.push(sessionId);
    } else {
      args.push('--last');
    }
  }
  const prompt = (input.prompt ?? '').trim();
  if (prompt) {
    args.push(prompt);
  }
  return args;
}

function codexModelArg(model?: string): string | undefined {
  const trimmed = (model ?? '').trim();
  return trimmed || undefined;
}

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
      return {
        command: 'codex',
        args: codexSpawnArgs({
          model: codexModelArg(task.agentModel),
          yolo: task.agentYolo,
          prompt: initialPrompt,
        }),
      };
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
      return {
        command: 'codex',
        args: codexSpawnArgs({
          model: codexModelArg(task.agentModel),
          yolo: task.agentYolo,
          resume: { sessionId: resumeId },
        }),
      };
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
 * All planning agents read `planning/CLAUDE.md` and `planning/AGENTS.md` for Fluxx CLI usage.
 *
 * @param agentModel — For `claude-code` / `codex`, non-empty → `--model`; for `cursor`, passed to
 *   `--model` (default `auto` when blank).
 */
export type PlanningSpawnResumeOptions = {
  agentConversationId?: string;
};

/**
 * Planning PTY resume argv: same model / yolo flags as {@link planningSpawnSpec}, then
 * `--resume` or `--resume <id>` when captured from PTY output.
 */
export function planningSpawnResumeSpec(
  agent: Agent,
  agentModel?: string,
  agentYolo?: boolean,
  options: PlanningSpawnResumeOptions = {},
): { command: string; args: string[] } {
  const resumeId = options.agentConversationId?.trim();
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
      if (resumeId) {
        args.push('--resume', resumeId);
      } else {
        args.push('--resume');
      }
      return { command: 'claude', args };
    }
    case 'codex':
      return {
        command: 'codex',
        args: codexSpawnArgs({
          model: codexModelArg(agentModel),
          yolo: agentYolo,
          resume: { sessionId: resumeId },
        }),
      };
    case 'cursor': {
      const model = (agentModel ?? '').trim() || 'auto';
      const args: string[] = ['--model', model];
      if (agentYolo === true) {
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

export function planningSpawnSpec(
  agent: Agent,
  agentModel?: string,
  agentYolo?: boolean,
  initialPrompt?: string,
): { command: string; args: string[] } {
  const prompt = (initialPrompt ?? '').trim();
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
      if (prompt) {
        args.push(prompt);
      }
      return { command: 'claude', args };
    }
    case 'codex':
      return {
        command: 'codex',
        args: codexSpawnArgs({
          model: codexModelArg(agentModel),
          yolo: agentYolo,
          prompt,
        }),
      };
    case 'cursor': {
      const model = (agentModel ?? '').trim() || 'auto';
      const args: string[] = ['--model', model, '--approve-mcps'];
      if (agentYolo === true) {
        args.push('--yolo');
      }
      if (prompt) {
        args.push(prompt);
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
  if (agent === 'codex') {
    return `${command} not found on PATH. Install Codex CLI: https://developers.openai.com/codex/cli/ (e.g. npm install -g @openai/codex)`;
  }
  return `${command} not found on PATH`;
}
