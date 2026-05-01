import { useEffect, useRef } from 'react';
import type {
  ActiveProjectKey,
  CloudProject,
  LocalProject,
  Task,
} from '../../types';
import type {
  McpBridgeMember,
  McpBridgeProjectInfoResult,
  McpBridgeRequest,
  McpBridgeResponse,
  McpBridgeTasksCreatePayload,
  McpBridgeTasksDeletePayload,
  McpBridgeTasksUpdatePayload,
  McpBridgeTasksUpdateResult,
} from '../../mcpBridge';
import { fetchProjectMembersForBridge } from '../projects/members';
import type { TaskProvider } from '../tasks/TaskProvider';

type ActiveProject = LocalProject | CloudProject;

export interface McpBridgeContext {
  project: ActiveProject | null;
  provider: TaskProvider | null;
  uid: string | null;
  tasksSnapshot: Task[];
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
        const created = await provider.create(payload.input);
        if (payload.input.description !== undefined) {
          const withDescription = await provider.update(created.id, {
            description: payload.input.description,
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
        const updated = await provider.update(payload.taskId, payload.patch);
        const result: McpBridgeTasksUpdateResult = { previous, updated };
        return { id: req.id, ok: true, data: result };
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
          done: 0,
          total: tasksSnapshot.length,
        };
        for (const t of tasksSnapshot) {
          if (t.status === 'backlog') taskCounts.backlog++;
          else if (t.status === 'in-progress') taskCounts['in-progress']++;
          else if (t.status === 'needs-input') taskCounts['needs-input']++;
          else if (t.status === 'done') taskCounts.done++;
        }
        const result: McpBridgeProjectInfoResult = {
          name: project.name,
          activeKey: currentKey,
          uid: uid ?? null,
          taskCounts,
        };
        return { id: req.id, ok: true, data: result };
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
