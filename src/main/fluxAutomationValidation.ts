import type { Agent, Session, Task } from '../types';
import { expectedTaskFluxxWorkBranch } from '../taskBranch';
import { isValidationPackId } from '../validationPacks/registry';
import type { ValidationPackId } from '../validationPacks/types';
import { validationRunToCliJson } from '../validationRuns/cliJson';
import type { ValidationRun } from '../validationRuns/types';
import type { FluxAutomationInvokeResponse } from './AutomationHttpServer';
import type { FluxAutomationHost } from './fluxAutomationRuns';
import { resolveTaskWorktreePath } from './openWorkspacePath';
import type { ValidationRunStore } from './ValidationRunStore';
import { ingestValidationVerdict } from './validationVerdictIngest';

export type FluxAutomationValidationHost = FluxAutomationHost & {
  validationRunStore: ValidationRunStore;
  listTerminalSessions: () => Promise<Session[]>;
  getRecordProjectDir: () => string;
};

function requireProjectDir(h: FluxAutomationValidationHost): string | FluxAutomationInvokeResponse {
  const dir = h.getRecordProjectDir()?.trim();
  if (!dir) {
    return { ok: false, error: 'No project directory open for validation runs' };
  }
  return dir;
}

type ResolveTaskResult =
  | { ok: true; task: Task }
  | { ok: false; response: FluxAutomationInvokeResponse };

async function resolveTaskForValidation(
  h: FluxAutomationValidationHost,
  taskId: string,
): Promise<ResolveTaskResult> {
  const local = h.getTaskInCurrentProject(taskId);
  if (local) return { ok: true, task: local };
  const active = h.resolveActive();
  if (active.kind !== 'cloud') {
    return {
      ok: false,
      response: { ok: false, error: 'Task not found or not part of the current project' },
    };
  }
  const listResult = await h.bridge.request<Task[]>('tasks.list', active.activeKey);
  if (!listResult.ok) {
    return { ok: false, response: h.bridgeFailureToInvoke(listResult) };
  }
  const task = listResult.data.find((t) => t.id === taskId);
  if (!task) {
    return {
      ok: false,
      response: { ok: false, error: 'Task not found or not part of the current project' },
    };
  }
  return { ok: true, task };
}

function resolveProjectId(h: FluxAutomationValidationHost): string | null {
  const active = h.resolveActive();
  if (active.kind === 'local') return active.project.id;
  if (active.kind === 'cloud') return active.activeKey.id;
  return null;
}

function defaultValidatorAgent(): Agent {
  const raw = process.env.FLUXX_VALIDATOR_AGENT?.trim();
  if (raw === 'claude-code' || raw === 'codex' || raw === 'cursor') return raw;
  return 'cursor';
}

async function resolveWorktreeCwdForTask(
  h: FluxAutomationValidationHost,
  task: Task,
  projectDir: string,
): Promise<string | undefined> {
  const resolved = await resolveTaskWorktreePath(
    task.id,
    () => h.listTerminalSessions(),
    projectDir,
    task.repoId,
    task.fluxxWorkBranch ?? expectedTaskFluxxWorkBranch(task),
  );
  return resolved ?? undefined;
}

async function maybeIngestVerdict(
  h: FluxAutomationValidationHost,
  run: ValidationRun,
): Promise<ValidationRun> {
  const result = await ingestValidationVerdict(h.validationRunStore, run.id);
  if (!result.ok) return run;
  return result.run;
}

export async function automationRunValidationRun(
  h: FluxAutomationValidationHost,
  input: { taskId: string; packId?: string; validatorAgent?: Agent },
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  const projectDirResult = requireProjectDir(h);
  if (typeof projectDirResult !== 'string') return projectDirResult;

  const taskId = input.taskId?.trim();
  if (!taskId) {
    return { ok: false, error: 'taskId is required' };
  }

  const packId = (input.packId?.trim() || 'electron-playwright') as ValidationPackId;
  if (!isValidationPackId(packId)) {
    return { ok: false, error: `Unsupported validation pack: ${packId}` };
  }

  const taskResult = await resolveTaskForValidation(h, taskId);
  if (!taskResult.ok) return taskResult.response;
  const task = taskResult.task;

  const projectId = resolveProjectId(h);
  if (!projectId) {
    return { ok: false, error: 'No project open' };
  }

  const validatorAgent = input.validatorAgent ?? defaultValidatorAgent();
  const worktreeCwd = await resolveWorktreeCwdForTask(h, task, projectDirResult);

  try {
    const run = await h.validationRunStore.create({
      taskId: task.id,
      projectId,
      ...(task.repoId?.trim() ? { repoId: task.repoId.trim() } : {}),
      packId,
      validatorAgent,
      ...(worktreeCwd ? { worktreeCwd } : {}),
    });
    const cliRun = validationRunToCliJson(run);
    return {
      ok: true,
      data: {
        runId: run.id,
        artifactDir: run.artifactDir,
        run: cliRun,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function automationRunValidationList(
  h: FluxAutomationValidationHost,
  input: { taskId: string },
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  const projectDirResult = requireProjectDir(h);
  if (typeof projectDirResult !== 'string') return projectDirResult;

  const taskId = input.taskId?.trim();
  if (!taskId) {
    return { ok: false, error: 'taskId is required' };
  }

  const taskResult = await resolveTaskForValidation(h, taskId);
  if (!taskResult.ok) return taskResult.response;

  try {
    const runs = await h.validationRunStore.listForTask(taskId);
    return {
      ok: true,
      data: {
        taskId,
        runs: runs.map(validationRunToCliJson),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function automationRunValidationShow(
  h: FluxAutomationValidationHost,
  input: { runId: string },
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  const projectDirResult = requireProjectDir(h);
  if (typeof projectDirResult !== 'string') return projectDirResult;

  const runId = input.runId?.trim();
  if (!runId) {
    return { ok: false, error: 'runId is required' };
  }

  try {
    let run = await h.validationRunStore.get(runId);
    if (!run) {
      return { ok: false, error: `Validation run not found: ${runId}` };
    }
    run = await maybeIngestVerdict(h, run);
    return { ok: true, data: { run: validationRunToCliJson(run) } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function automationRunValidationArtifacts(
  h: FluxAutomationValidationHost,
  input: { runId: string },
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  const projectDirResult = requireProjectDir(h);
  if (typeof projectDirResult !== 'string') return projectDirResult;

  const runId = input.runId?.trim();
  if (!runId) {
    return { ok: false, error: 'runId is required' };
  }

  try {
    let run = await h.validationRunStore.get(runId);
    if (!run) {
      return { ok: false, error: `Validation run not found: ${runId}` };
    }
    run = await maybeIngestVerdict(h, run);
    return {
      ok: true,
      data: {
        runId: run.id,
        taskId: run.taskId,
        artifacts: run.artifacts.map((a) => ({
          id: a.id,
          kind: a.kind,
          label: a.label,
          path: a.path,
          createdAt: a.createdAt,
          fileState: a.fileState,
        })),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function automationRunValidationIngest(
  h: FluxAutomationValidationHost,
  input: { runId: string },
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  const projectDirResult = requireProjectDir(h);
  if (typeof projectDirResult !== 'string') return projectDirResult;

  const runId = input.runId?.trim();
  if (!runId) {
    return { ok: false, error: 'runId is required' };
  }

  const result = await ingestValidationVerdict(h.validationRunStore, runId);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    data: {
      ingested: result.ingested,
      run: validationRunToCliJson(result.run),
    },
  };
}
