import type { ActiveProjectKey, Task } from '../types';
import { resolvePrimaryRepoId } from '../repoIdentity';
import { expectedTaskFluxxWorkBranch } from '../taskBranch';
import type { ValidationRun } from '../validationRuns/types';
import type { RendererAutomationBridge } from './RendererAutomationBridge';
import type { ProjectStore } from './ProjectStore';
import type { TaskStore } from './TaskStore';
import type { TerminalBackend } from './terminalBackend/TerminalBackend';
import type { ValidationRunStore } from './ValidationRunStore';
import { resolveTaskWorktreePath } from './openWorkspacePath';
import {
  autoStartValidationOnEntry,
  maybeMoveTaskToReviewAfterValidationPass,
  type LaunchValidatorSessionFn,
} from './validationTaskTransitions';
import { reconcileActiveValidationRun } from './reconcileValidationRun';

export type ValidationTransitionHooks = {
  onEnteredValidation: (previous: Task, updated: Task, source: string) => Promise<void>;
  onRunPassed: (run: ValidationRun, source: string) => Promise<void>;
};

export function buildValidationTransitionHooks(input: {
  validationRunStore: ValidationRunStore;
  launchValidatorSession: LaunchValidatorSessionFn;
  projectStore: ProjectStore;
  taskStore: TaskStore;
  terminalBackend: TerminalBackend;
  getRecordProjectDir: () => string;
  getActiveProjectKey: () => ActiveProjectKey | null;
  bridge: RendererAutomationBridge;
  updateLocalTask: (
    id: string,
    patch: { status: 'review' },
    source: string,
  ) => Promise<Task>;
  broadcastLocalTasksChanged: () => void;
  ensureValidatorBindingsHydrated: () => Promise<void>;
}): ValidationTransitionHooks {
  const getValidationEnabled = async (): Promise<boolean> => {
    const dir = input.getRecordProjectDir()?.trim();
    if (!dir) return false;
    try {
      return await input.projectStore.getValidationEnabledAt(dir);
    } catch {
      return false;
    }
  };

  const getPrimaryRepoId = async (): Promise<string | undefined> => {
    const dir = input.getRecordProjectDir()?.trim();
    if (!dir) return undefined;
    try {
      const repos = await input.projectStore.getReposAt(dir);
      return resolvePrimaryRepoId(repos);
    } catch {
      return undefined;
    }
  };

  const resolveWorktreePath = async (task: Task): Promise<string | undefined> => {
    const projectDir = input.getRecordProjectDir()?.trim();
    if (!projectDir) return undefined;
    const resolved = await resolveTaskWorktreePath(
      task.id,
      () => input.terminalBackend.listSessions(),
      projectDir,
      task.repoId,
      task.fluxxWorkBranch ?? expectedTaskFluxxWorkBranch(task),
    );
    return resolved ?? undefined;
  };

  const autoStartDeps = {
    validationRunStore: input.validationRunStore,
    launchValidatorSession: input.launchValidatorSession,
    getValidationEnabled,
    getPrimaryRepoId,
    resolveWorktreePath,
    listTerminalSessions: () => input.terminalBackend.listSessions(),
    ensureValidatorBindingsHydrated: input.ensureValidatorBindingsHydrated,
    reconcileActiveRun: (run, source) =>
      reconcileActiveValidationRun(
        {
          validationRunStore: input.validationRunStore,
          terminalBackend: input.terminalBackend,
        },
        run,
        source,
      ),
  };

  const getLocalTask = (taskId: string): Task | null => {
    const project = input.projectStore.get();
    if (!project) return null;
    return input.taskStore.getAll(project.id).find((t) => t.id === taskId) ?? null;
  };

  const getTask = async (taskId: string): Promise<Task | null> => {
    const local = getLocalTask(taskId);
    if (local) return local;
    const activeKey = input.getActiveProjectKey();
    if (activeKey?.kind !== 'cloud') return null;
    const listResult = await input.bridge.request<Task[]>('tasks.list', activeKey);
    if (!listResult.ok) return null;
    return listResult.data.find((t) => t.id === taskId) ?? null;
  };

  const updateTaskToReview = async (taskId: string): Promise<void> => {
    const activeKey = input.getActiveProjectKey();
    if (activeKey?.kind === 'cloud') {
      const result = await input.bridge.request<Task>('tasks.update', activeKey, {
        taskId,
        patch: { status: 'review' },
      });
      if (!result.ok) {
        throw new Error(result.message);
      }
      return;
    }
    await input.updateLocalTask(taskId, { status: 'review' }, 'validation:passed');
    input.broadcastLocalTasksChanged();
  };

  const passDeps = {
    getValidationEnabled,
    getTask,
    updateTaskToReview,
  };

  return {
    onEnteredValidation: async (previous, updated, source) => {
      await autoStartValidationOnEntry(previous, updated, autoStartDeps, source);
    },
    onRunPassed: async (run, source) => {
      await maybeMoveTaskToReviewAfterValidationPass(run, passDeps, source);
    },
  };
}

export async function handleValidationRunFinalized(
  run: ValidationRun | null,
  hooks: ValidationTransitionHooks | null,
  source: string,
): Promise<void> {
  if (!run || !hooks) return;
  await hooks.onRunPassed(run, source);
}
