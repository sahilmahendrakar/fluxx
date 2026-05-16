import type { Task } from '../../types';
import type {
  TaskCreateInput,
  TaskPatch,
  TaskProvider,
} from './TaskProvider';

/**
 * Wraps `window.electronAPI.tasks.*`. Holds an in-memory copy of the task list
 * and re-notifies subscribers on every local mutation. The host calls
 * `reloadFromMain()` when main emits `tasks:changed` (for example after MCP
 * tool calls).
 */
export class LocalTaskProvider implements TaskProvider {
  private tasks: Task[] = [];
  private subscribers = new Set<(tasks: Task[]) => void>();
  private loadPromise: Promise<void> | null = null;

  subscribe(cb: (tasks: Task[]) => void): () => void {
    this.subscribers.add(cb);
    cb(this.tasks);
    void this.ensureLoaded();
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = window.electronAPI.tasks
        .getAll()
        .then((all) => {
          this.tasks = all;
          this.emit();
        })
        .catch((err) => {
          console.error('[LocalTaskProvider] getAll failed', err);
        });
    }
    return this.loadPromise;
  }

  private emit(): void {
    const snapshot = this.tasks.slice();
    for (const cb of this.subscribers) cb(snapshot);
  }

  reloadFromMain = async (): Promise<void> => {
    const all = await window.electronAPI.tasks.getAll();
    this.tasks = all;
    this.emit();
  };

  async create(input: TaskCreateInput): Promise<Task> {
    const task = await window.electronAPI.tasks.create({
      title: input.title,
      agent: input.agent,
      ...(input.agentModel !== undefined ? { agentModel: input.agentModel } : {}),
      ...(input.agentYolo !== undefined ? { agentYolo: input.agentYolo } : {}),
      ...(input.blockedByTaskIds?.length ? { blockedByTaskIds: input.blockedByTaskIds } : {}),
      ...(input.labels !== undefined ? { labels: input.labels } : {}),
      ...(input.sourceBranch !== undefined ? { sourceBranch: input.sourceBranch } : {}),
      ...(input.createSourceBranchIfMissing !== undefined
        ? { createSourceBranchIfMissing: input.createSourceBranchIfMissing }
        : {}),
      ...(input.repoId !== undefined ? { repoId: input.repoId } : {}),
      ...(input.attachedPlanningDocs !== undefined
        ? { attachedPlanningDocs: input.attachedPlanningDocs }
        : {}),
    });
    this.tasks = [...this.tasks, task];
    this.emit();
    return task;
  }

  async update(id: string, patch: TaskPatch): Promise<Task> {
    // assigneeId is cloud-only (no persisted multi-user owner on disk); strip before IPC.
    // Auto-assign when enabling auto-start on unblock is cloud-only in App.
    const localPatch = { ...patch };
    delete localPatch.assigneeId;
    const updated = await window.electronAPI.tasks.update(id, localPatch);
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    this.emit();
    return updated;
  }

  async delete(id: string): Promise<void> {
    await window.electronAPI.tasks.delete(id);
    this.tasks = this.tasks.filter((t) => t.id !== id);
    this.emit();
  }
}
