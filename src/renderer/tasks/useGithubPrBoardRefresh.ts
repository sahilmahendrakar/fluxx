import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Task } from '../../types';
import { githubPrRefreshViewEqual } from '../../githubPrMetadata';
import type { TaskProvider } from './TaskProvider';

const DEBOUNCE_MS = 1800;
const POLL_MS = 7 * 60 * 1000;
const CONCURRENCY = 2;

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const runNext = async (): Promise<void> => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      const item = items[idx];
      if (item === undefined) return;
      await fn(item);
    }
  };
  const n = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => runNext()));
}

/**
 * Refreshes linked GitHub PR metadata for board tasks (debounced). Local tasks
 * are persisted in the main process when the IPC row exists; cloud tasks are
 * updated here only when `githubPr` meaningfully changes, to limit Firestore
 * writes across teammates.
 */
export function useGithubPrBoardRefresh(input: {
  projectId: string | undefined;
  projectKind: 'local' | 'cloud' | undefined;
  provider: TaskProvider | null;
  tasks: Task[];
  enabled: boolean;
}): void {
  const { projectId, projectKind, provider, tasks, enabled } = input;
  const generationRef = useRef(0);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const kindRef = useRef(projectKind);
  kindRef.current = projectKind;

  const tasksGithubPrKey = useMemo(() => {
    return tasks
      .flatMap((t) => {
        const g = t.githubPr;
        const url = g?.url?.trim();
        if (!url || !g) return [];
        return [`${t.id}:${url}:${g.state ?? ''}:${g.mergedAt ?? ''}:${g.number ?? ''}`];
      })
      .sort()
      .join('|');
  }, [tasks]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const execute = useCallback(async () => {
    const prov = providerRef.current;
    const kind = kindRef.current;
    if (!enabled || !projectId || !kind || !prov) return;
    const list = tasksRef.current.filter((t) => t.githubPr?.url?.trim());
    if (list.length === 0) return;
    const gen = generationRef.current;
    await runPool(list, CONCURRENCY, async (task) => {
      if (generationRef.current !== gen) return;
      const pr = task.githubPr;
      if (!pr?.url?.trim()) return;
      try {
        const result = await window.electronAPI.tasks.refreshPullRequest({
          taskId: task.id,
          githubPr: pr,
        });
        if (generationRef.current !== gen) return;
        if (!result.ok) {
          console.warn('[githubPrRefresh]', task.id, result.code, result.message);
          return;
        }
        if (githubPrRefreshViewEqual(task.githubPr, result.githubPr)) return;
        if (kind === 'cloud') {
          await prov.update(task.id, { githubPr: result.githubPr });
        }
      } catch (err) {
        console.warn('[githubPrRefresh] error', task.id, err);
      }
    });
  }, [enabled, projectId]);

  const schedule = useCallback(() => {
    if (!enabled || !projectId || !projectKind || !provider) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void execute();
    }, DEBOUNCE_MS);
  }, [enabled, projectId, projectKind, provider, execute]);

  useEffect(() => {
    if (!enabled || !projectId || !projectKind || !provider) return;
    schedule();
    return () => {
      generationRef.current += 1;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [enabled, projectId, projectKind, provider, tasksGithubPrKey, schedule]);

  useEffect(() => {
    if (!enabled || !projectId) return;
    const onFocus = () => schedule();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, projectId, schedule]);

  useEffect(() => {
    if (!enabled || !projectId) return;
    const id = window.setInterval(() => schedule(), POLL_MS);
    return () => clearInterval(id);
  }, [enabled, projectId, schedule]);
}
