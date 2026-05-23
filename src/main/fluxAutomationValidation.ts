import type { Agent, Session, Task } from '../types';
import { expectedTaskFluxxWorkBranch } from '../taskBranch';
import { isValidationPackId } from '../validationPacks/registry';
import type { ValidationPackId } from '../validationPacks/types';
import { validationRunToCliJson } from '../validationRuns/cliJson';
import type { ValidationRun } from '../validationRuns/types';
import {
  validationDisabledInvokeResponse,
} from '../validation/validationEnabled';
import type { FluxAutomationInvokeResponse } from './AutomationHttpServer';
import type { FluxAutomationHost } from './fluxAutomationRuns';
import { resolveValidationEnabledForAutomationHost } from './fluxAutomationRuns';
import { resolveTaskWorktreePath } from './openWorkspacePath';
import type { ValidationRunStore } from './ValidationRunStore';
import { defaultValidatorAgent } from './startValidatorSession';
import { finalizeValidationRun } from './finalizeValidationRun';
import { ingestValidationVerdict } from './validationVerdictIngest';

export type FluxAutomationValidationHost = FluxAutomationHost & {
  validationRunStore: ValidationRunStore;
  listTerminalSessions: () => Promise<Session[]>;
  getRecordProjectDir: () => string;
  notifyValidationRunChanged?: (runId: string) => void;
  launchValidatorSession?: (input: {
    task: Task;
    runId: string;
  }) => Promise<
    | { ok: true; run: ValidationRun; sessionId: string }
    | { ok: false; error: string }
  >;
};

async function requireValidationEnabled(
  h: FluxAutomationValidationHost,
): Promise<FluxAutomationInvokeResponse | null> {
  if (!(await resolveValidationEnabledForAutomationHost(h))) {
    return validationDisabledInvokeResponse();
  }
  return null;
}

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

async function maybeLaunchValidator(
  h: FluxAutomationValidationHost,
  task: Task,
  run: ValidationRun,
  launch: boolean | undefined,
): Promise<{ run: ValidationRun; sessionId?: string; launchError?: string }> {
  if (launch === false || !h.launchValidatorSession) {
    return { run };
  }
  const launched = await h.launchValidatorSession({ task, runId: run.id });
  if (!launched.ok) {
    return { run, launchError: launched.error };
  }
  return { run: launched.run, sessionId: launched.sessionId };
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
  input: { taskId: string; packId?: string; validatorAgent?: Agent; launch?: boolean },
): Promise<FluxAutomationInvokeResponse> {
  const disabled = await requireValidationEnabled(h);
  if (disabled) return disabled;
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
    let run = await h.validationRunStore.create({
      taskId: task.id,
      projectId,
      ...(task.repoId?.trim() ? { repoId: task.repoId.trim() } : {}),
      packId,
      validatorAgent,
      ...(worktreeCwd ? { worktreeCwd } : {}),
      ...(task.validationPlan !== undefined ? { validationPlan: task.validationPlan } : {}),
    });
    const launchResult = await maybeLaunchValidator(h, task, run, input.launch);
    run = launchResult.run;
    const cliRun = validationRunToCliJson(run);
    return {
      ok: true,
      data: {
        runId: run.id,
        artifactDir: run.artifactDir,
        run: cliRun,
        ...(launchResult.sessionId ? { validatorSessionId: launchResult.sessionId } : {}),
        ...(launchResult.launchError ? { launchError: launchResult.launchError } : {}),
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
  const disabled = await requireValidationEnabled(h);
  if (disabled) return disabled;
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
  const disabled = await requireValidationEnabled(h);
  if (disabled) return disabled;
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
  const disabled = await requireValidationEnabled(h);
  if (disabled) return disabled;
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
  const disabled = await requireValidationEnabled(h);
  if (disabled) return disabled;
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
  h.notifyValidationRunChanged?.(runId);
  return {
    ok: true,
    data: {
      ingested: result.ingested,
      run: validationRunToCliJson(result.run),
    },
  };
}

export async function automationRunValidationFinish(
  h: FluxAutomationValidationHost,
  input: { runId: string },
): Promise<FluxAutomationInvokeResponse> {
  const disabled = await requireValidationEnabled(h);
  if (disabled) return disabled;
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

  const result = await finalizeValidationRun(h.validationRunStore, {
    runId,
    source: 'finish',
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  h.notifyValidationRunChanged?.(runId);
  return {
    ok: true,
    data: {
      ingested: result.ingested,
      run: validationRunToCliJson(result.run),
    },
  };
}

export async function automationRunValidationLaunch(
  h: FluxAutomationValidationHost,
  input: { runId: string; taskId?: string },
): Promise<FluxAutomationInvokeResponse> {
  const disabled = await requireValidationEnabled(h);
  if (disabled) return disabled;
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  if (!h.launchValidatorSession) {
    return { ok: false, error: 'Validator launch is not available in this context' };
  }
  const projectDirResult = requireProjectDir(h);
  if (typeof projectDirResult !== 'string') return projectDirResult;

  const runId = input.runId?.trim();
  if (!runId) {
    return { ok: false, error: 'runId is required' };
  }

  const run = await h.validationRunStore.get(runId);
  if (!run) {
    return { ok: false, error: `Validation run not found: ${runId}` };
  }

  const taskId = (input.taskId?.trim() || run.taskId).trim();
  const taskResult = await resolveTaskForValidation(h, taskId);
  if (!taskResult.ok) return taskResult.response;
  if (taskResult.task.id !== run.taskId) {
    return { ok: false, error: 'Validation run does not belong to this task' };
  }

  const launched = await h.launchValidatorSession({ task: taskResult.task, runId });
  if (!launched.ok) {
    return { ok: false, error: launched.error };
  }
  return {
    ok: true,
    data: {
      runId: launched.run.id,
      validatorSessionId: launched.sessionId,
      run: validationRunToCliJson(launched.run),
    },
  };
}
