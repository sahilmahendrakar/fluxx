import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useEffect, useRef } from 'react';
import type { AgentState } from '../../terminal-runtime/protocol';
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
}): Promise<void> {
  const { projectId, sessions, tasks, uid, provider, setTasks, source } = p;
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

  for (const { id, state } of silenceStates) {
    const taskId = sessionToTask.get(id);
    if (!taskId) continue;
    const task = taskById.get(taskId);
    if (!task || task.projectId !== projectId) continue;
    if (state !== 'silent' || task.status !== 'in-progress') {
      if (state === 'silent' && task.status !== 'in-progress') {
        console.log('[task:status] reconcile skip: task not in-progress', {
          taskId,
          status: task.status,
          source,
        });
      }
      continue;
    }
    if (!uid || task.assigneeId !== uid) {
      console.log('[task:status] reconcile skip: assignee mismatch', {
        taskId,
        assigneeId: task.assigneeId,
        currentUid: uid,
        source,
      });
      continue;
    }

    console.log('[task:status] in-progress → needs-input (silence reconcile)', {
      taskId,
      assigneeId: task.assigneeId,
      source,
    });
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'needs-input' } : t)),
    );
    void provider.update(taskId, { status: 'needs-input' }).catch((err) => {
      console.error('[task:status] Firestore write failed (needs-input, reconcile)', {
        taskId,
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
  }, [opts.enabled, opts.projectId, opts.setTasks]);
}
