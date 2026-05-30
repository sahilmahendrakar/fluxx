import fs from 'node:fs/promises';
import path from 'node:path';
import type { Agent, Session, Task } from '../types';
import { getValidationPackById } from '../validationPacks/registry';
import { resolveValidationPackConfig } from '../validationPacks/resolveValidationPackConfig';
import { buildValidationPackInstructions } from '../validationPacks/buildInstructions';
import type { ValidationRun } from '../validationRuns/types';
import { agentNotFoundMessage, agentSpawnSpec } from './agentSpawn';
import { composeValidatorSessionPrompt } from './composeValidatorSessionPrompt';
import {
  captureGitStatusPorcelain,
  captureWorktreeChangeSummary,
} from './gitStatusGuardrail';
import { snapshotValidationPlanToRunDir } from '../validationPlans/snapshotPlan';
import { pickSessionForTaskWorktree } from './openWorkspacePath';
import type { TerminalBackend } from './terminalBackend/TerminalBackend';
import { finalizeValidationRun } from './finalizeValidationRun';
import type { ValidationRunStore } from './ValidationRunStore';
import { validationRunPtyEnv } from './validationRunEnv';
import {
  registerValidatorSession,
  unregisterValidatorSession,
} from './validatorSessionLifecycle';

export type StartValidatorSessionErrorCode =
  | 'TASK_NOT_IN_VALIDATION'
  | 'RUN_NOT_FOUND'
  | 'RUN_NOT_LAUNCHABLE'
  | 'WORKTREE_UNAVAILABLE'
  | 'AGENT_NOT_FOUND'
  | 'INTERNAL';

export type StartValidatorSessionResult =
  | { ok: true; run: ValidationRun; session: Session }
  | { ok: false; code: StartValidatorSessionErrorCode; message: string };

export type StartValidatorSessionDeps = {
  validationRunStore: ValidationRunStore;
  terminalBackend: TerminalBackend;
  listTerminalSessions: () => Promise<Session[]>;
  getProjectDir: () => string;
  resolveWorktreePath: (
    task: Task,
    projectDir: string,
  ) => Promise<{ worktreePath: string; branch: string; repoId?: string } | null>;
  buildSpawnContext: (worktreePath: string) => Promise<
    | {
        mcpConfigPath?: string;
        ptyEnv?: Record<string, string>;
        trustPromptAutorespond?: true;
        trustPromptAutorespondRoots?: string[];
      }
    | { error: string }
  >;
  materializeCursorMcp?: (worktreePath: string) => Promise<void>;
};

export type CompleteValidatorSessionDeps = {
  validationRunStore: ValidationRunStore;
  terminalBackend: TerminalBackend;
};

async function readInstructionsMarkdown(runDir: string): Promise<string> {
  const instructionsPath = path.join(runDir, 'instructions.md');
  try {
    return await fs.readFile(instructionsPath, 'utf8');
  } catch {
    return '_Pack instructions missing from run directory._\n';
  }
}

async function writeValidatorPromptArtifact(runDir: string, prompt: string): Promise<void> {
  await fs.writeFile(path.join(runDir, 'validator-prompt.md'), `${prompt}\n`, 'utf8');
}

export function defaultValidatorAgent(): Agent {
  const raw = process.env.FLUXX_VALIDATOR_AGENT?.trim();
  if (raw === 'claude-code' || raw === 'codex' || raw === 'cursor') return raw;
  return 'cursor';
}

export async function resolveValidatorWorktree(
  task: Task,
  projectDir: string,
  listSessions: () => Promise<Session[]>,
  fluxxWorkBranch?: string | null,
): Promise<{ worktreePath: string; branch: string; repoId?: string } | null> {
  const sessions = await listSessions();
  const match = pickSessionForTaskWorktree(sessions, task.id, task.repoId);
  if (match?.worktreePath?.trim()) {
    return {
      worktreePath: match.worktreePath,
      branch: match.branch?.trim() || fluxxWorkBranch?.trim() || 'main',
      ...(match.repoId?.trim() ? { repoId: match.repoId.trim() } : {}),
    };
  }
  const { resolveTaskWorktreePath } = await import('./openWorkspacePath');
  const worktreePath = await resolveTaskWorktreePath(
    task.id,
    listSessions,
    projectDir,
    task.repoId,
    fluxxWorkBranch ?? task.fluxxWorkBranch,
  );
  if (!worktreePath) return null;
  return {
    worktreePath,
    branch: fluxxWorkBranch?.trim() || task.fluxxWorkBranch?.trim() || 'main',
    ...(task.repoId?.trim() ? { repoId: task.repoId.trim() } : {}),
  };
}

export async function startValidatorSession(
  deps: StartValidatorSessionDeps,
  input: {
    task: Task;
    runId: string;
  },
): Promise<StartValidatorSessionResult> {
  if (input.task.status !== 'validation') {
    return {
      ok: false,
      code: 'TASK_NOT_IN_VALIDATION',
      message: 'Validation can only be launched for tasks in Validation.',
    };
  }

  const run = await deps.validationRunStore.get(input.runId);
  if (!run) {
    return {
      ok: false,
      code: 'RUN_NOT_FOUND',
      message: `Validation run not found: ${input.runId}`,
    };
  }
  if (run.taskId !== input.task.id) {
    return {
      ok: false,
      code: 'RUN_NOT_FOUND',
      message: 'Validation run does not belong to this task.',
    };
  }
  if (run.status !== 'queued') {
    return {
      ok: false,
      code: 'RUN_NOT_LAUNCHABLE',
      message: `Validation run is not queued (status: ${run.status}).`,
    };
  }

  const projectDir = deps.getProjectDir()?.trim();
  if (!projectDir) {
    return { ok: false, code: 'INTERNAL', message: 'No project directory open.' };
  }

  const worktree =
    (await deps.resolveWorktreePath(input.task, projectDir)) ??
    (await resolveValidatorWorktree(input.task, projectDir, deps.listTerminalSessions));
  if (!worktree) {
    return {
      ok: false,
      code: 'WORKTREE_UNAVAILABLE',
      message:
        'No task worktree found. Start an implementation session or ensure the worktree exists on disk.',
    };
  }

  const pack = getValidationPackById(run.packId);
  if (!pack) {
    return {
      ok: false,
      code: 'INTERNAL',
      message: `Validation pack not available: ${run.packId}`,
    };
  }

  const projectConfig = resolveValidationPackConfig({ projectDir, packId: run.packId });
  const hasProjectConfig = Object.keys(projectConfig).length > 0;
  const instructionsMarkdown =
    (await readInstructionsMarkdown(run.artifactDir)) ||
    buildValidationPackInstructions(pack, hasProjectConfig ? projectConfig : undefined);
  const changeSummary = await captureWorktreeChangeSummary(worktree.worktreePath);
  const preStatus = await captureGitStatusPorcelain(worktree.worktreePath);
  const planSnapshot = await snapshotValidationPlanToRunDir(
    run.artifactDir,
    input.task.validationPlan,
  );
  const prompt = composeValidatorSessionPrompt({
    task: input.task,
    run,
    worktreeCwd: worktree.worktreePath,
    instructionsMarkdown,
    verdictSchemaJson: pack.verdictSchemaJson,
    projectConfig,
    changeSummary,
    planJsonPath: path.join(run.artifactDir, 'plan.json'),
    ...(planSnapshot.ok ? { validationPlan: planSnapshot.plan } : {}),
    ...(!planSnapshot.ok && input.task.validationPlan != null
      ? { validationPlanWarning: planSnapshot.warning }
      : {}),
  });
  await writeValidatorPromptArtifact(run.artifactDir, prompt);

  if (run.validatorAgent === 'cursor' && deps.materializeCursorMcp) {
    try {
      await deps.materializeCursorMcp(worktree.worktreePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        code: 'INTERNAL',
        message: `Could not prepare Cursor MCP configuration: ${message}`,
      };
    }
  }

  const spawnCtx = await deps.buildSpawnContext(worktree.worktreePath);
  if ('error' in spawnCtx) {
    return { ok: false, code: 'INTERNAL', message: spawnCtx.error };
  }

  const validatorTaskAgent = {
    agent: run.validatorAgent,
    agentYolo: true as const,
  };
  const { command, args } = agentSpawnSpec(validatorTaskAgent, prompt, {
    ...(spawnCtx.mcpConfigPath ? { mcpConfigPath: spawnCtx.mcpConfigPath } : {}),
  });

  const ptyEnv = {
    ...(spawnCtx.ptyEnv ?? {}),
    ...validationRunPtyEnv(run),
  };

  const result = await deps.terminalBackend.createSession({
    worktreePath: worktree.worktreePath,
    branch: worktree.branch,
    taskId: input.task.id,
    projectId: run.projectId,
    ...(worktree.repoId ? { repoId: worktree.repoId } : {}),
    agent: run.validatorAgent,
    command,
    args,
    cols: 80,
    rows: 24,
    ...(spawnCtx.trustPromptAutorespond ? { trustPromptAutorespond: true } : {}),
    ...(spawnCtx.trustPromptAutorespondRoots
      ? { trustPromptAutorespondRoots: spawnCtx.trustPromptAutorespondRoots }
      : {}),
    ptyEnv,
  });

  if ('error' in result) {
    return {
      ok: false,
      code: 'AGENT_NOT_FOUND',
      message: agentNotFoundMessage(run.validatorAgent, command),
    };
  }

  registerValidatorSession(result.id, { runId: run.id, taskId: input.task.id });
  const launched = await deps.validationRunStore.markLaunched({
    runId: run.id,
    validatorSessionId: result.id,
    worktreeCwd: worktree.worktreePath,
    preValidationGitStatus: preStatus.porcelain,
  });

  await fs.writeFile(
    path.join(run.artifactDir, 'guardrails.json'),
    `${JSON.stringify(
      {
        preValidationGitStatus: preStatus.porcelain,
        preValidationCapturedAt: preStatus.capturedAt,
        worktreeCwd: worktree.worktreePath,
        validatorSessionId: result.id,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return { ok: true, run: launched, session: result };
}

export async function completeValidatorSessionOnExit(
  deps: CompleteValidatorSessionDeps,
  session: Session,
  runId: string,
): Promise<ValidationRun | null> {
  unregisterValidatorSession(session.id);

  const result = await finalizeValidationRun(deps.validationRunStore, {
    runId,
    session,
    source: 'session-exit',
  });
  if (!result.ok) return null;
  return result.run;
}

export async function cancelValidatorSession(
  deps: CompleteValidatorSessionDeps & { runId: string; sessionId: string },
): Promise<ValidationRun | null> {
  unregisterValidatorSession(deps.sessionId);
  await deps.terminalBackend.stopSession(deps.sessionId);
  const existing = await deps.validationRunStore.get(deps.runId);
  if (!existing || existing.status !== 'running') return existing;
  return deps.validationRunStore.updateStatus({
    runId: deps.runId,
    status: 'cancelled',
    verdictReason: 'Validation run cancelled.',
  });
}
