import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useEffect, useRef } from 'react';
import type { AgentState } from '../../terminal-runtime/protocol';
import {
  agentStateTaskStatusTransition,
  linkedAgentSessionStateForTask,
} from '../../githubPrReviewWhenOpenAutomation';
import type { Session, Task } from '../../types';
import type { TaskProvider } from './TaskProvider';

const CLOUD_SILENCE_POLL_MS = 30_000;

/**
 * Applies main-process silence snapshots to cloud tasks (assignee-gated). Shared by
 * startup catchup, periodic polling, optional legacy stream catchup, and visibility resume.
 */
export async function reconcileCloudSilenceFromDaemon(p: {
  projectId: string;
  sessions: Session[];
  tasks: Task[];
  uid: string | null;
  provider: TaskProvider | null;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  source: string;
  autoMoveToReviewWhenPrOpen: boolean;
}): Promise<void> {
  const { projectId, sessions, tasks, uid, provider, setTasks, source, autoMoveToReviewWhenPrOpen } =
    p;
  if (!provider) return;

  let silenceStates: { id: string; taskId?: string; state: AgentState }[];
  try {
    silenceStates = await window.electronAPI.sessions.getSilenceStates();
  } catch (err) {
    console.warn('[task:status] cloud silence reconcile getSilenceStates failed', {
      source,
      err,
    });
    return;
  }

  const sessionToTask = new Map<string, string>();
  for (const s of sessions) {
    if (s.taskId && s.projectId === projectId) sessionToTask.set(s.id, s.taskId);
  }
  for (const row of silenceStates) {
    if (row.taskId && !sessionToTask.has(row.id)) sessionToTask.set(row.id, row.taskId);
  }

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const taskIds = new Set<string>();
  for (const row of silenceStates) {
    const taskId = sessionToTask.get(row.id) ?? row.taskId;
    if (taskId) taskIds.add(taskId);
  }

  for (const taskId of taskIds) {
    const task = taskById.get(taskId);
    if (!task || task.projectId !== projectId) continue;

    const linkedAgentSessionState = linkedAgentSessionStateForTask(taskId, silenceStates);
    const state: AgentState = linkedAgentSessionState === 'active' ? 'active' : 'silent';
    const nextStatus = agentStateTaskStatusTransition({
      state,
      task,
      autoMoveToReviewWhenPrOpen,
      linkedAgentSessionState,
    });
    if (!nextStatus || nextStatus === task.status) continue;

    if (!uid || task.assigneeId !== uid) {
      console.log('[task:status] reconcile skip: assignee mismatch', {
        taskId,
        assigneeId: task.assigneeId,
        currentUid: uid,
        source,
      });
      continue;
    }

    console.log('[task:status] agent-state column transition (reconcile)', {
      taskId,
      from: task.status,
      to: nextStatus,
      agentState: state,
      source,
    });
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: nextStatus } : t)),
    );
    void provider.update(taskId, { status: nextStatus }).catch((err) => {
      console.error('[task:status] Firestore write failed (reconcile)', {
        taskId,
        nextStatus,
        source,
        err,
      });
    });
  }
}

/** Polls session silence state for cloud projects independent of terminal mounts. */
export function useCloudSilenceReconciliation(opts: {
  enabled: boolean;
  projectId: string | undefined;
  sessions: Session[];
  tasksRef: MutableRefObject<Task[]>;
  uidRef: MutableRefObject<string | null>;
  providerRef: MutableRefObject<TaskProvider | null>;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  autoMoveToReviewWhenPrOpen: boolean;
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!opts.enabled || !opts.projectId) return;

    const run = (source: string) => {
      const cur = optsRef.current;
      if (!cur.enabled || !cur.projectId) return;
      void reconcileCloudSilenceFromDaemon({
        projectId: cur.projectId,
        sessions: cur.sessions,
        tasks: cur.tasksRef.current,
        uid: cur.uidRef.current,
        provider: cur.providerRef.current,
        setTasks: cur.setTasks,
        source,
        autoMoveToReviewWhenPrOpen: cur.autoMoveToReviewWhenPrOpen,
      });
    };

    run('hook:initial');

    const pollTimer = window.setInterval(() => run('poll'), CLOUD_SILENCE_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') run('visibility');
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [opts.enabled, opts.projectId, opts.setTasks, opts.autoMoveToReviewWhenPrOpen]);
}
