import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useEffect, useRef } from 'react';
import type { AgentState } from '../../daemon/protocol';
import type { Session, Task } from '../../types';
import type { TaskProvider } from './TaskProvider';

const CLOUD_SILENCE_POLL_MS = 30_000;

/**
 * Applies daemon silence snapshots to cloud tasks (assignee-gated). Shared by
 * startup catchup, periodic polling, stream reconnect, and visibility resume.
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
    if (state !== 'silent' || task.status !== 'in-progress') continue;
    if (!uid || task.assigneeId !== uid) continue;

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

/** Polls daemon silence state for cloud projects independent of terminal mounts. */
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
    const unsubCatchup = window.electronAPI.sessions.onDaemonStreamCatchup(() =>
      run('daemon-stream-catchup'),
    );
    const onVisibility = () => {
      if (document.visibilityState === 'visible') run('visibility');
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(pollTimer);
      unsubCatchup();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [opts.enabled, opts.projectId, opts.setTasks]);
}
