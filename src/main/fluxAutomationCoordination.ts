import type { FluxAutomationInvokeResponse } from './AutomationHttpServer';
import type { FluxAutomationHost } from './fluxAutomationRuns';
import type { OverseerBindingStore } from './overseerBindingStore';
import type {
  AutomationBridgeCoordinationApprovePayload,
  AutomationBridgeCoordinationRequestReworkPayload,
  AutomationBridgeCoordinationSubmitHandoffPayload,
  AutomationBridgeCoordinationTaskResult,
} from '../rendererAutomationBridge';
import type { Task, TaskHandoffMergeState, TaskStatus } from '../types';
import {
  parseTaskOverseerReviewInput,
  parseTaskWorkerHandoffForCoordination,
  parseTaskWorkerHandoffFromJsonString,
} from '../taskAgentHandoff';
import { resolvePrimaryRepoIdFromList } from '../repoIdentity';
import type { AutomationBridgeOp } from '../rendererAutomationBridge';

type CoordinationTaskPatch = {
  workerHandoff?: Task['workerHandoff'] | null;
  overseerReview?: Task['overseerReview'] | null;
  handoffMergeState?: TaskHandoffMergeState | null;
  status?: TaskStatus;
};

async function applyCoordinationTaskPatch(
  h: FluxAutomationHost,
  bridgeOp: Extract<
    AutomationBridgeOp,
    'coordination.submitHandoff' | 'coordination.approveHandoff' | 'coordination.requestRework'
  >,
  taskId: string,
  patch: CoordinationTaskPatch,
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  const localPatch = {
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.workerHandoff !== undefined ? { workerHandoff: patch.workerHandoff } : {}),
    ...(patch.overseerReview !== undefined ? { overseerReview: patch.overseerReview } : {}),
    ...(patch.handoffMergeState !== undefined ? { handoffMergeState: patch.handoffMergeState } : {}),
  };
  if (active.kind === 'local') {
    const existing = h.getTaskInCurrentProject(taskId);
    if (!existing) {
      return { ok: false, error: 'Task not found or not part of the current project' };
    }
    const updated = await h.taskActions.updateTask(taskId, localPatch);
    h.notifyTasksChanged();
    return { ok: true, data: { task: updated } satisfies AutomationBridgeCoordinationTaskResult };
  }
  const result = await h.bridge.request<AutomationBridgeCoordinationTaskResult>(
    bridgeOp,
    active.activeKey,
    buildBridgePayload(taskId, patch),
  );
  if (!result.ok) return h.bridgeFailureToInvoke(result);
  return { ok: true, data: result.data };
}

function buildBridgePayload(
  taskId: string,
  patch: CoordinationTaskPatch,
):
  | AutomationBridgeCoordinationSubmitHandoffPayload
  | AutomationBridgeCoordinationApprovePayload
  | AutomationBridgeCoordinationRequestReworkPayload {
  if (patch.workerHandoff) {
    return { taskId, handoff: patch.workerHandoff };
  }
  if (patch.overseerReview?.decision === 'approved') {
    return {
      taskId,
      review: patch.overseerReview,
      handoffMergeState: patch.handoffMergeState ?? 'pending-merge',
    };
  }
  return {
    taskId,
    review: patch.overseerReview!,
    handoffMergeState: patch.handoffMergeState ?? 'rework-requested',
    status: patch.status ?? 'in-progress',
  };
}

export async function automationRunRegisterOverseer(
  h: FluxAutomationHost,
  store: OverseerBindingStore,
  input: {
    repoId?: string;
    sourceBranch: string;
    planningSessionId?: string;
  },
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  const sourceBranch = input.sourceBranch?.trim() ?? '';
  if (!sourceBranch) {
    return { ok: false, error: 'sourceBranch is required' };
  }
  const planningSessionId = input.planningSessionId?.trim() ?? '';
  if (!planningSessionId) {
    return {
      ok: false,
      error: 'planningSessionId is required (pass --planning-session-id)',
    };
  }
  let projectId: string;
  let repoId: string;
  if (active.kind === 'local') {
    projectId = active.project.id;
    const repos = await h.projectStore.getReposAt(active.projectDir);
    const primary = resolvePrimaryRepoIdFromList(repos);
    repoId = input.repoId?.trim() || primary || '';
    if (!repoId) {
      return { ok: false, error: 'repoId is required when the project has no primary repository' };
    }
    if (!repos.some((r) => r.id === repoId)) {
      return { ok: false, error: 'Unknown repository id for this project' };
    }
  } else {
    projectId = active.activeKey.id;
    const info = await h.bridge.request<{ primaryRepoId?: string }>('projectInfo', active.activeKey);
    if (!info.ok) return h.bridgeFailureToInvoke(info);
    repoId = input.repoId?.trim() || info.data.primaryRepoId || '';
    if (!repoId) {
      return { ok: false, error: 'repoId is required (pass --repo-id)' };
    }
  }
  try {
    const binding = await store.register({
      projectId,
      repoId,
      sourceBranch,
      planningSessionId,
    });
    return { ok: true, data: { binding } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function automationRunSubmitHandoff(
  h: FluxAutomationHost,
  input: { taskId: string; handoff?: unknown; handoffJson?: string },
): Promise<FluxAutomationInvokeResponse> {
  const taskId = input.taskId?.trim();
  if (!taskId) {
    return { ok: false, error: 'taskId is required' };
  }
  let parsed;
  if (input.handoffJson !== undefined) {
    parsed = parseTaskWorkerHandoffFromJsonString(input.handoffJson);
  } else if (input.handoff !== undefined) {
    parsed = parseTaskWorkerHandoffForCoordination(input.handoff);
  } else {
    return { ok: false, error: 'handoff or handoffJson is required' };
  }
  if (!parsed.ok) {
    return { ok: false, error: parsed.message };
  }
  const existing = await loadTaskForCoordination(h, taskId);
  if (!existing.ok) return existing;
  return applyCoordinationTaskPatch(h, 'coordination.submitHandoff', taskId, {
    workerHandoff: parsed.handoff,
    overseerReview: null,
    handoffMergeState: null,
    status: 'review',
  });
}

export async function automationRunApproveHandoff(
  h: FluxAutomationHost,
  input: { taskId: string; notes?: string },
): Promise<FluxAutomationInvokeResponse> {
  const taskId = input.taskId?.trim();
  if (!taskId) {
    return { ok: false, error: 'taskId is required' };
  }
  const task = await loadTaskForCoordination(h, taskId);
  if (!task.ok) return task;
  if (!task.data.workerHandoff) {
    return { ok: false, error: 'Task has no worker handoff to approve' };
  }
  const reviewParsed = parseTaskOverseerReviewInput({
    decision: 'approved',
    notes: input.notes,
  });
  if (!reviewParsed.ok) {
    return { ok: false, error: reviewParsed.message };
  }
  return applyCoordinationTaskPatch(h, 'coordination.approveHandoff', taskId, {
    overseerReview: reviewParsed.review,
    handoffMergeState: 'pending-merge',
  });
}

export async function automationRunRequestRework(
  h: FluxAutomationHost,
  input: { taskId: string; instructions: string; notes?: string },
): Promise<FluxAutomationInvokeResponse> {
  const taskId = input.taskId?.trim();
  if (!taskId) {
    return { ok: false, error: 'taskId is required' };
  }
  const task = await loadTaskForCoordination(h, taskId);
  if (!task.ok) return task;
  if (!task.data.workerHandoff) {
    return { ok: false, error: 'Task has no worker handoff to send back for rework' };
  }
  const reviewParsed = parseTaskOverseerReviewInput({
    decision: 'rework',
    reworkInstructions: input.instructions,
    notes: input.notes,
  });
  if (!reviewParsed.ok) {
    return { ok: false, error: reviewParsed.message };
  }
  return applyCoordinationTaskPatch(h, 'coordination.requestRework', taskId, {
    overseerReview: reviewParsed.review,
    handoffMergeState: 'rework-requested',
    status: 'in-progress',
  });
}

async function loadTaskForCoordination(
  h: FluxAutomationHost,
  taskId: string,
): Promise<{ ok: true; data: Task } | { ok: false; error: string }> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  if (active.kind === 'local') {
    const task = h.getTaskInCurrentProject(taskId);
    if (!task) {
      return { ok: false, error: 'Task not found or not part of the current project' };
    }
    return { ok: true, data: task };
  }
  const list = await h.bridge.request<Task[]>('tasks.list', active.activeKey);
  if (!list.ok) {
    const failed = h.bridgeFailureToInvoke(list);
    if (!failed.ok) {
      return { ok: false, error: failed.error };
    }
    return { ok: false, error: 'Failed to load tasks' };
  }
  const task = list.data.find((t) => t.id === taskId);
  if (!task) {
    return { ok: false, error: 'Task not found or not part of the current project' };
  }
  return { ok: true, data: task };
}
