import { useEffect, useMemo, useState } from 'react';
import type { Session } from '../../types';
import {
  subscribeToRunners,
  writeRunner,
  type RunnerEntry,
} from './runners';
import { activeTaskIdsForRunnerHeartbeat } from './runnerHeartbeat';

/** A runner is considered "live" if its lastSeen is within this window. */
const STALE_THRESHOLD_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

export interface RunnersByTask {
  /** taskId → (uid → entry) */
  byTask: Map<string, Map<string, RunnerEntry>>;
  /** Whether any non-stale runner is currently "running" for the given task. */
  isRunningFresh(taskId: string): boolean;
}

export function useRunners(projectId: string | null): RunnersByTask {
  const [rows, setRows] = useState<RunnerEntry[]>([]);

  useEffect(() => {
    if (!projectId) {
      setRows([]);
      return;
    }
    const unsub = subscribeToRunners(projectId, setRows);
    return () => unsub();
  }, [projectId]);

  return useMemo(() => {
    const byTask = new Map<string, Map<string, RunnerEntry>>();
    for (const r of rows) {
      let inner = byTask.get(r.taskId);
      if (!inner) {
        inner = new Map();
        byTask.set(r.taskId, inner);
      }
      inner.set(r.uid, r);
    }
    return {
      byTask,
      isRunningFresh(taskId: string) {
        const inner = byTask.get(taskId);
        if (!inner) return false;
        const now = Date.now();
        for (const r of inner.values()) {
          if (r.status !== 'running') continue;
          const seen = Date.parse(r.lastSeen);
          if (!Number.isFinite(seen)) continue;
          if (now - seen <= STALE_THRESHOLD_MS) return true;
        }
        return false;
      },
    };
  }, [rows]);
}

/**
 * Heartbeat loop for the signed-in user. For every local Desktop session (not
 * direct SSH) whose task belongs to the active cloud project, writes a running
 * doc every 30s; writes idle once when the session ends. Direct SSH is
 * Desktop-controlled and is not represented as a cloud runner.
 */
export function useAgentHeartbeat(opts: {
  projectId: string | null;
  uid: string | null;
  displayName?: string;
  photoURL?: string;
}): void {
  const { projectId, uid, displayName, photoURL } = opts;

  useEffect(() => {
    if (!projectId || !uid) return;
    let cancelled = false;

    /** taskIds this client is currently heartbeating as 'running'. */
    const running = new Set<string>();
    const flush = async () => {
      if (cancelled) return;
      let sessions: Session[] = [];
      try {
        sessions = await window.electronAPI.sessions.getAll();
      } catch (err) {
        console.error('[heartbeat] sessions.getAll failed', err);
        return;
      }
      const activeTaskIds = activeTaskIdsForRunnerHeartbeat(sessions, projectId);
      // Beat 'running' for currently-active sessions.
      for (const taskId of activeTaskIds) {
        running.add(taskId);
        try {
          await writeRunner(projectId, taskId, uid, 'running', displayName, photoURL);
        } catch (err) {
          console.error('[heartbeat] writeRunner(running) failed', err);
        }
      }
      // Mark 'idle' once for sessions that stopped since our last beat.
      for (const taskId of Array.from(running)) {
        if (activeTaskIds.has(taskId)) continue;
        running.delete(taskId);
        try {
          await writeRunner(projectId, taskId, uid, 'idle', displayName, photoURL);
        } catch (err) {
          console.error('[heartbeat] writeRunner(idle) failed', err);
        }
      }
    };

    void flush();
    const timer = setInterval(() => void flush(), HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, uid, displayName, photoURL]);
}
