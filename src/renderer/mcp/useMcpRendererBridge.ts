import { useEffect, useRef, type MutableRefObject } from 'react';
import { maybeCloudAutoStartSessionOnInProgressTransition } from '../../cloudInProgressAutostartApply';
import { runCloudDoneTransitionFollowUp } from '../../cloudTaskDoneFollowUp';
import type {
  ActiveProjectKey,
  CloudProject,
  LocalProject,
  Task,
} from '../../types';
import { resolveCloudPrimaryRepoId } from '../../cloudBindingPrefs';
import type {
  McpBridgeMember,
  McpBridgeProjectInfoRepoSummary,
  McpBridgeProjectInfoResult,
  McpBridgeRepoBranchDiscoveryPayload,
  McpBridgeRequest,
  McpBridgeResponse,
  McpBridgeTasksCreatePayload,
  McpBridgeTasksDeletePayload,
  McpBridgeTasksUpdatePayload,
  McpBridgeTasksUpdateResult,
} from '../../mcpBridge';
import { fetchProjectMembersForBridge } from '../projects/members';
import type { TaskProvider } from '../tasks/TaskProvider';
import { assigneePatchForCloudAutoStartOnUnblock } from '../../cloudAutoStartUnblockAssignee';

type ActiveProject = LocalProject | CloudProject;

export interface McpBridgeContext {
  project: ActiveProject | null;
  provider: TaskProvider | null;
  uid: string | null;
  tasksSnapshot: Task[];
  tasksRef: MutableRefObject<Task[]>;
  /** Dedupes cloud auto-start with board/detail/unblock paths (same Set as App). */
  cloudAutostartInFlightRef: MutableRefObject<Set<string>>;
  cloudInlineDoneFollowUpTaskIdsRef: MutableRefObject<Set<string>>;
  setCleanupLoadingTaskId?: (taskId: string | null) => void;
  stripLocalSessionStateForTask?: (taskId: string) => void;
}

/**
 * Mounts the renderer-side IPC handler that responds to MCP bridge requests
 * from the main process. The active TaskProvider, project, uid, and current
 * tasks snapshot are read at request time via a ref so the handler always
 * reflects the latest state without re-subscribing.
 *
 * Signals readiness once on first mount so the main bridge can release any
 * waiting requests.
 */
export function useMcpRendererBridge(ctx: McpBridgeContext): void {
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  useEffect(() => {
    const unsub = window.electronAPI.mcpBridge.onRequest((req) => {
      void handleRequest(req, ctxRef.current).then((resp) => {
        window.electronAPI.mcpBridge.respond(resp);
      });
    });
    window.electronAPI.mcpBridge.signalReady();
    return unsub;
  }, []);
}

function activeKeyForProject(project: ActiveProject): ActiveProjectKey {
  return { kind: project.kind, id: project.id };
}

function activeKeyMatches(
  expected: ActiveProjectKey,
  current: ActiveProjectKey,
): boolean {
  return expected.kind === current.kind && expected.id === current.id;
}

async function handleRequest(
  req: McpBridgeRequest,
  ctx: McpBridgeContext,
): Promise<McpBridgeResponse> {
  const { project, provider, uid, tasksSnapshot } = ctx;
  if (!project) {
    return {
      id: req.id,
      ok: false,
      code: 'NO_ACTIVE_PROJECT',
      message: 'No active project in renderer',
    };
  }
  const currentKey = activeKeyForProject(project);
  if (!activeKeyMatches(req.expectedActiveKey, currentKey)) {
    return {
      id: req.id,
      ok: false,
      code: 'PROJECT_KIND_MISMATCH',
      message: `Expected ${req.expectedActiveKey.kind}/${req.expectedActiveKey.id}, renderer has ${currentKey.kind}/${currentKey.id}`,
    };
  }
  if (project.kind === 'cloud' && !uid) {
    return {
      id: req.id,
      ok: false,
      code: 'AUTH_NOT_READY',
      message: 'Sign in to Flux to use cloud project tools',
    };
  }
  if (!provider) {
    return {
      id: req.id,
      ok: false,
      code: 'AUTH_NOT_READY',
      message: 'TaskProvider not ready',
    };
  }

  try {
    switch (req.op) {
      case 'tasks.list':
        return { id: req.id, ok: true, data: tasksSnapshot };
      case 'tasks.create': {
        const payload = req.payload as McpBridgeTasksCreatePayload;
        if (!payload?.input) {
          return {
            id: req.id,
            ok: false,
            code: 'INVALID_PAYLOAD',
            message: 'tasks.create requires payload.input',
          };
        }
        const input = payload.input;
        if (project.kind === 'cloud') {
          const rid = input.repoId?.trim();
          if (rid) {
            const known = project.sharedRepos.some((r) => r.id === rid);
            if (!known) {
              return {
                id: req.id,
                ok: false,
                code: 'INVALID_PAYLOAD',
                message: `Unknown repository id for this project: ${rid}`,
              };
            }
          }
        }
        const created = await provider.create(input);
        if (input.description !== undefined) {
          const withDescription = await provider.update(created.id, {
            description: input.description,
          });
          return { id: req.id, ok: true, data: withDescription };
        }
        return { id: req.id, ok: true, data: created };
      }
      case 'tasks.update': {
        const payload = req.payload as McpBridgeTasksUpdatePayload;
        if (!payload?.taskId || !payload?.patch) {
          return {
            id: req.id,
            ok: false,
            code: 'INVALID_PAYLOAD',
            message: 'tasks.update requires payload.taskId and payload.patch',
          };
        }
        const previous =
          tasksSnapshot.find((t) => t.id === payload.taskId) ?? null;
        let patch = payload.patch;
        if (
          project.kind === 'cloud' &&
          patch.repoId !== undefined
        ) {
          const rid = String(patch.repoId).trim();
          if (rid !== '' && !project.sharedRepos.some((r) => r.id === rid)) {
            return {
              id: req.id,
              ok: false,
              code: 'INVALID_PAYLOAD',
              message: `Unknown repository id for this project: ${rid}`,
            };
          }
        }
        if (
          project.kind === 'cloud' &&
          uid &&
          previous &&
          patch.status === 'in-progress' &&
          !previous.assigneeId
        ) {
          if (patch.assigneeId === undefined) {
            patch = { ...patch, assigneeId: uid };
          }
        }
        if (previous) {
          patch = {
            ...patch,
            ...assigneePatchForCloudAutoStartOnUnblock({
              projectKind: project.kind,
              actorUid: uid ?? undefined,
              previousAssigneeId: previous.assigneeId,
              patch,
            }),
          };
        }
        const lockDone =
          project.kind === 'cloud' &&
          previous &&
          previous.status !== 'done' &&
          patch.status === 'done';
        if (lockDone) {
          ctx.cloudInlineDoneFollowUpTaskIdsRef.current.add(payload.taskId);
        }
        try {
          const updated = await provider.update(payload.taskId, patch);
          if (project.kind === 'cloud' && previous) {
            const allTasksForSession = tasksSnapshot.map((t) =>
              t.id === payload.taskId ? updated : t,
            );
            await maybeCloudAutoStartSessionOnInProgressTransition(
              previous,
              updated,
              allTasksForSession,
              {
                source: 'cloud:mcpBridge',
                inFlight: ctx.cloudAutostartInFlightRef.current,
                logError: (msg, data) => console.error(msg, data),
                actorUid: uid,
              },
            );
          }
          let outUpdated = updated;
          let workspaceCleanedAfterDone = false;
          if (
            project.kind === 'cloud' &&
            previous &&
            previous.status !== 'done' &&
            updated.status === 'done'
          ) {
            const allAfter = tasksSnapshot.map((t) =>
              t.id === payload.taskId ? updated : t,
            );
            const follow = await runCloudDoneTransitionFollowUp({
              previous,
              updated,
              allAfter,
              provider,
              actorUid: uid,
              unblockInFlight: ctx.cloudAutostartInFlightRef.current,
              getTasks: () => ctx.tasksRef.current,
              setCleanupLoadingTaskId: ctx.setCleanupLoadingTaskId,
              onStripSessions: ctx.stripLocalSessionStateForTask,
            });
            outUpdated = follow.task;
            if (follow.workspaceCleaned) {
              workspaceCleanedAfterDone = true;
            }
          }
          const result: McpBridgeTasksUpdateResult = {
            previous,
            updated: outUpdated,
            ...(workspaceCleanedAfterDone ? { workspaceCleanedAfterDone: true } : {}),
          };
          return { id: req.id, ok: true, data: result };
        } finally {
          if (lockDone) {
            ctx.cloudInlineDoneFollowUpTaskIdsRef.current.delete(payload.taskId);
          }
        }
      }
      case 'tasks.delete': {
        const payload = req.payload as McpBridgeTasksDeletePayload;
        if (!payload?.taskId) {
          return {
            id: req.id,
            ok: false,
            code: 'INVALID_PAYLOAD',
            message: 'tasks.delete requires payload.taskId',
          };
        }
        await provider.delete(payload.taskId);
        return { id: req.id, ok: true, data: { deletedId: payload.taskId } };
      }
      case 'members.list': {
        if (project.kind !== 'cloud') {
          const empty: McpBridgeMember[] = [];
          return { id: req.id, ok: true, data: empty };
        }
        const listed = await fetchProjectMembersForBridge(project.id);
        return { id: req.id, ok: true, data: listed };
      }
      case 'projectInfo': {
        const taskCounts = {
          backlog: 0,
          'in-progress': 0,
          'needs-input': 0,
          review: 0,
          done: 0,
          total: tasksSnapshot.length,
        };
        for (const t of tasksSnapshot) {
          if (t.status === 'backlog') taskCounts.backlog++;
          else if (t.status === 'in-progress') taskCounts['in-progress']++;
          else if (t.status === 'needs-input') taskCounts['needs-input']++;
          else if (t.status === 'review') taskCounts.review++;
          else if (t.status === 'done') taskCounts.done++;
        }
        let defaultBranchShort: string | undefined;
        let branchDiscoveryError: string | undefined;
        try {
          const disc = await window.electronAPI.repo.getBranchDiscovery();
          if ('error' in disc) {
            branchDiscoveryError = disc.error;
          } else {
            defaultBranchShort = disc.defaultBranchShort;
          }
        } catch (err) {
          branchDiscoveryError = err instanceof Error ? err.message : String(err);
        }
        const result: McpBridgeProjectInfoResult = {
          name: project.name,
          activeKey: currentKey,
          uid: uid ?? null,
          taskCounts,
          ...(defaultBranchShort !== undefined ? { defaultBranchShort } : {}),
          ...(branchDiscoveryError !== undefined ? { branchDiscoveryError } : {}),
        };
        if (project.kind === 'cloud') {
          const primaryRepoId = resolveCloudPrimaryRepoId(project);
          const repos: McpBridgeProjectInfoRepoSummary[] = await Promise.all(
            project.sharedRepos.map(async (sr) => {
              const machine = project.repoMachineBindings[sr.id];
              const binding: McpBridgeProjectInfoRepoSummary['binding'] = machine
                ? 'bound'
                : 'missing_binding';
              let repoDefaultShort: string | undefined;
              if (machine) {
                const rawDisc = await window.electronAPI.repo.getBranchDiscovery({
                  repoId: sr.id,
                });
                if (!('error' in rawDisc)) {
                  repoDefaultShort = rawDisc.defaultBranchShort;
                }
              }
              return {
                id: sr.id,
                label: sr.name,
                isPrimary: primaryRepoId !== undefined && sr.id === primaryRepoId,
                configuredDefaultBranch: sr.baseBranch,
                ...(repoDefaultShort !== undefined ? { defaultBranchShort: repoDefaultShort } : {}),
                ...(machine ? { rootPath: machine.rootPath } : {}),
                binding,
              };
            }),
          );
          if (primaryRepoId !== undefined) {
            result.primaryRepoId = primaryRepoId;
          }
          result.repos = repos;
        }
        return { id: req.id, ok: true, data: result };
      }
      case 'repo.branchDiscovery': {
        const payload = (req.payload ?? {}) as McpBridgeRepoBranchDiscoveryPayload;
        const repoIdArg =
          payload.repoId != null &&
          payload.repoId.trim() !== '' &&
          project.kind === 'cloud'
            ? payload.repoId.trim()
            : undefined;
        if (
          repoIdArg &&
          project.kind === 'cloud' &&
          !project.sharedRepos.some((r) => r.id === repoIdArg)
        ) {
          return {
            id: req.id,
            ok: false,
            code: 'INVALID_PAYLOAD',
            message: `Unknown repository id for this project: ${repoIdArg}`,
          };
        }
        const raw = await window.electronAPI.repo.getBranchDiscovery({
          ...(repoIdArg !== undefined ? { repoId: repoIdArg } : {}),
          ...(payload.classifyBranch !== undefined ? { classifyBranch: payload.classifyBranch } : {}),
        });
        if ('error' in raw) {
          return {
            id: req.id,
            ok: false,
            code: 'PROVIDER_ERROR',
            message: raw.error,
          };
        }
        return { id: req.id, ok: true, data: raw };
      }
      default:
        return {
          id: req.id,
          ok: false,
          code: 'UNKNOWN_OP',
          message: `Unknown op: ${(req as { op: string }).op}`,
        };
    }
  } catch (err) {
    return {
      id: req.id,
      ok: false,
      code: 'PROVIDER_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
