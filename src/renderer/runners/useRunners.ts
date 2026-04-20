import { useEffect, useMemo, useState } from 'react';
import type { Session } from '../../types';
import {
  subscribeToRunners,
  writeRunner,
  type RunnerEntry,
} from './runners';

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
 * Heartbeat loop for the signed-in user. For every local session whose taskId
 * belongs to the active cloud project, writes a running-status doc every 30s;
 * writes an idle-status doc once when the session ends. We intentionally
 * don't mark stale runners from other machines as idle — the viewer's stale
 * check handles presentation.
 */
export function useAgentHeartbeat(opts: {
  projectId: string | null;
  uid: string | null;
  displayName?: string;
}): void {
  const { projectId, uid, displayName } = opts;

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
      const activeTaskIds = new Set(
        sessions
          .filter((s) => s.status === 'running' && s.projectId === projectId)
          .map((s) => s.taskId),
      );
      // Beat 'running' for currently-active sessions.
      for (const taskId of activeTaskIds) {
        running.add(taskId);
        try {
          await writeRunner(projectId, taskId, uid, 'running', displayName);
        } catch (err) {
          console.error('[heartbeat] writeRunner(running) failed', err);
        }
      }
      // Mark 'idle' once for sessions that stopped since our last beat.
      for (const taskId of Array.from(running)) {
        if (activeTaskIds.has(taskId)) continue;
        running.delete(taskId);
        try {
          await writeRunner(projectId, taskId, uid, 'idle', displayName);
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
  }, [projectId, uid, displayName]);
}
