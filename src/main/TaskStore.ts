import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Agent, Task } from '../types';
import { validateBlockedByTaskIds } from '../taskDependencies';
import { normalizeTaskLabels } from '../taskLabels';

type TaskInput = {
  title: string;
  agent: Agent;
  projectId: string;
  blockedByTaskIds?: string[];
  labels?: string[];
};

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

export class TaskStore {
  private filePath: string | null;
  private tasks: Task[] = [];

  constructor(private projectDir: string) {
    this.filePath = projectDir ? path.join(projectDir, 'tasks.json') : null;
  }

  async reinit(projectDir: string): Promise<void> {
    this.projectDir = projectDir;
    this.filePath = projectDir ? path.join(projectDir, 'tasks.json') : null;

    // One-time migration from userData
    const oldPath = path.join(app.getPath('userData'), 'tasks.json');
    if (this.filePath) {
      try {
        await fs.access(oldPath);
        try {
          await fs.access(this.filePath);
          // new file already exists, skip migration
        } catch {
          await fs.copyFile(oldPath, this.filePath);
          console.log('Migrated tasks.json to', this.filePath);
        }
      } catch {
        // no old file, nothing to migrate
      }
    }

    await this.init();
  }

  async init(): Promise<void> {
    if (!this.filePath) {
      this.tasks = [];
      return;
    }

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        console.warn(
          '[TaskStore] tasks.json contains malformed JSON; starting with an empty task list.',
        );
        this.tasks = [];
        return;
      }
      if (!Array.isArray(parsed)) {
        console.warn(
          '[TaskStore] tasks.json is not a JSON array; starting with an empty task list.',
        );
        this.tasks = [];
        return;
      }
      this.tasks = parsed as Task[];
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') {
        this.tasks = [];
        return;
      }
      throw err;
    }
  }

  /** Assign `projectId` to tasks missing it (e.g. legacy data), then persist if needed. */
  async migrateMissingProjectIds(projectId: string): Promise<void> {
    if (!this.filePath) return;
    let changed = false;
    this.tasks = this.tasks.map((t) => {
      if (t.projectId == null || t.projectId === '') {
        changed = true;
        return { ...t, projectId: projectId };
      }
      return t;
    });
    if (changed) {
      await this.save();
    }
  }

  async remapProjectId(from: string, to: string): Promise<void> {
    if (!this.filePath || from === to) {
      return;
    }
    let changed = false;
    this.tasks = this.tasks.map((t) => {
      if (t.projectId === from) {
        changed = true;
        return { ...t, projectId: to };
      }
      return t;
    });
    if (changed) {
      await this.save();
    }
  }

  getAll(projectId?: string): Task[] {
    if (!this.filePath) {
      return [];
    }
    if (!projectId) {
      return this.tasks;
    }
    return this.tasks.filter((t) => t.projectId === projectId);
  }

  async create(input: TaskInput): Promise<Task> {
    if (!this.filePath) {
      throw new Error('No project directory open for tasks');
    }
    const labelNorm = normalizeTaskLabels(input.labels);
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      status: 'backlog',
      agent: input.agent,
      createdAt: new Date().toISOString(),
      projectId: input.projectId,
    };
    if (labelNorm.length > 0) {
      task.labels = labelNorm;
    }
    if (input.blockedByTaskIds != null && input.blockedByTaskIds.length > 0) {
      const v = validateBlockedByTaskIds(
        task.id,
        input.blockedByTaskIds,
        [...this.tasks, task],
        false,
      );
      if (!v.ok) {
        throw new Error(v.message);
      }
      task.blockedByTaskIds = v.normalized;
    }
    this.tasks.push(task);
    await this.save();
    return task;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        Task,
        | 'title'
        | 'status'
        | 'agent'
        | 'agentModel'
        | 'agentYolo'
        | 'description'
        | 'orderKey'
        | 'workspaceCleanedAt'
        | 'blockedByTaskIds'
        | 'labels'
        | 'autoStartOnUnblock'
      >
    > & { assigneeId?: string | null },
  ): Promise<Task> {
    if (!this.filePath) {
      throw new Error('No project directory open for tasks');
    }
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new Error(`Task not found: ${id}`);
    }
    const current = this.tasks[index];
    const { assigneeId: patchAssigneeId, ...patchRest } = patch;
    const updated: Task = {
      ...current,
      ...patchRest,
    };
    if (patch.labels !== undefined) {
      const n = normalizeTaskLabels(patch.labels);
      if (n.length > 0) {
        updated.labels = n;
      } else {
        delete updated.labels;
      }
    }
    if (patch.autoStartOnUnblock !== undefined) {
      if (patch.autoStartOnUnblock) {
        updated.autoStartOnUnblock = true;
      } else {
        delete updated.autoStartOnUnblock;
      }
    }
    if (patchAssigneeId !== undefined) {
      if (patchAssigneeId === null || patchAssigneeId === '') {
        delete updated.assigneeId;
      } else {
        updated.assigneeId = patchAssigneeId;
      }
    }
    this.tasks[index] = updated;
    await this.save();
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.filePath) {
      return;
    }
    const next = this.tasks.filter((t) => t.id !== id);
    if (next.length === this.tasks.length) {
      return;
    }
    this.tasks = next.map((t) => ({
      ...t,
      blockedByTaskIds: (t.blockedByTaskIds ?? []).filter((bid) => bid !== id),
    }));
    await this.save();
  }

  private async save(): Promise<void> {
    if (!this.filePath) {
      return;
    }
    const tmpPath = `${this.filePath}.tmp`;
    const payload = `${JSON.stringify(this.tasks, null, 2)}\n`;
    await fs.writeFile(tmpPath, payload, 'utf8');
    if (process.platform === 'win32') {
      try {
        await fs.unlink(this.filePath);
      } catch (err: unknown) {
        const code = errnoCode(err);
        if (code !== 'ENOENT') {
          throw err;
        }
      }
    }
    await fs.rename(tmpPath, this.filePath);
  }
}
