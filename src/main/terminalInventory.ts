import type {
  PlanningSession,
  Session,
  Shell,
  TerminalInventorySnapshot,
  TerminalSessionRecord,
} from '../types';

export type TerminalInventoryLiveInput = {
  sessions: Session[];
  planning: PlanningSession[];
  shells: Shell[];
  sessionById: Map<string, Session>;
};

/**
 * Builds a diagnostic snapshot of live in-memory terminals vs open manifest rows.
 * Used for quit confirmation, startup reconciliation logs, and tests.
 */
export function buildTerminalInventorySnapshot(
  live: TerminalInventoryLiveInput,
  persistedOpen: TerminalSessionRecord[],
  projectDir: string | null,
): TerminalInventorySnapshot {
  const runningSessions = live.sessions.filter((s) => s.status === 'running');
  const runningPlanning = live.planning.filter((s) => s.status === 'running');
  const runningShells = live.shells.filter((s) => s.status === 'running');

  const liveCounts = {
    taskSessions: runningSessions.length,
    planningSessions: runningPlanning.length,
    shells: runningShells.length,
    total: runningSessions.length + runningPlanning.length + runningShells.length,
  };

  const openTask = persistedOpen.filter((r) => r.kind === 'task').length;
  const openPlanning = persistedOpen.filter((r) => r.kind === 'planning').length;
  const openShell = persistedOpen.filter((r) => r.kind === 'shell').length;
  const persistedCounts = {
    taskSessions: openTask,
    planningSessions: openPlanning,
    shells: openShell,
    total: openTask + openPlanning + openShell,
  };

  const byProjectMap = new Map<
    string,
    { taskSessions: number; planningSessions: number; shells: number }
  >();

  const bump = (
    projectId: string,
    kind: 'taskSessions' | 'planningSessions' | 'shells',
  ): void => {
    const cur = byProjectMap.get(projectId) ?? {
      taskSessions: 0,
      planningSessions: 0,
      shells: 0,
    };
    cur[kind] += 1;
    byProjectMap.set(projectId, cur);
  };

  for (const s of runningSessions) bump(s.projectId, 'taskSessions');
  for (const p of runningPlanning) bump(p.projectId, 'planningSessions');
  for (const sh of runningShells) {
    const parent = live.sessionById.get(sh.sessionId);
    if (parent) bump(parent.projectId, 'shells');
  }
  for (const r of persistedOpen) {
    if (r.kind === 'task') bump(r.projectId, 'taskSessions');
    else if (r.kind === 'planning') bump(r.projectId, 'planningSessions');
    else bump(r.projectId, 'shells');
  }

  const byProject = [...byProjectMap.entries()].map(([projectId, counts]) => ({
    projectId,
    projectDir: projectDir ?? '',
    ...counts,
  }));

  type WorkspaceKey = string;
  const workspaceMap = new Map<
    WorkspaceKey,
    {
      projectId: string;
      taskId?: string;
      worktreePath?: string;
      planningDir?: string;
      terminalIds: string[];
      tmuxSessionNames: string[];
    }
  >();

  const workspaceKey = (r: {
    projectId: string;
    taskId?: string;
    worktreePath?: string;
    planningDir?: string;
  }): WorkspaceKey =>
    [
      r.projectId,
      r.taskId ?? '',
      r.worktreePath ?? '',
      r.planningDir ?? '',
    ].join('\0');

  const addToWorkspace = (
    projectId: string,
    terminalId: string,
    tmuxSessionName: string | undefined,
    meta: { taskId?: string; worktreePath?: string; planningDir?: string },
  ): void => {
    const key = workspaceKey({ projectId, ...meta });
    const existing = workspaceMap.get(key) ?? {
      projectId,
      ...meta,
      terminalIds: [],
      tmuxSessionNames: [],
    };
    if (!existing.terminalIds.includes(terminalId)) {
      existing.terminalIds.push(terminalId);
    }
    if (tmuxSessionName && !existing.tmuxSessionNames.includes(tmuxSessionName)) {
      existing.tmuxSessionNames.push(tmuxSessionName);
    }
    workspaceMap.set(key, existing);
  };

  for (const s of runningSessions) {
    addToWorkspace(s.projectId, s.id, undefined, {
      taskId: s.taskId,
      worktreePath: s.worktreePath,
    });
  }
  for (const p of runningPlanning) {
    addToWorkspace(p.projectId, p.id, undefined, { planningDir: p.planningDir });
  }
  for (const sh of runningShells) {
    const parent = live.sessionById.get(sh.sessionId);
    if (!parent) continue;
    addToWorkspace(parent.projectId, sh.id, undefined, {
      taskId: parent.taskId,
      worktreePath: sh.worktreePath,
    });
  }
  for (const r of persistedOpen) {
    if (r.kind === 'task' && r.task) {
      addToWorkspace(r.projectId, r.id, r.tmuxSessionName, {
        taskId: r.task.taskId,
        worktreePath: r.task.worktreePath,
      });
    } else if (r.kind === 'planning' && r.planning) {
      addToWorkspace(r.projectId, r.id, r.tmuxSessionName, {
        planningDir: r.planning.planningDir,
      });
    } else if (r.kind === 'shell' && r.shell) {
      const parent = live.sessionById.get(r.shell.parentSessionId);
      addToWorkspace(r.projectId, r.id, r.tmuxSessionName, {
        taskId: parent?.taskId,
        worktreePath: r.shell.worktreePath,
      });
    }
  }

  return {
    live: liveCounts,
    persistedOpen: persistedCounts,
    byProject,
    byWorkspace: [...workspaceMap.values()],
  };
}
