import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Agent, Task } from '../types';

export class TaskStore {
  private filePath: string;
  private tasks: Task[] = [];

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'tasks.json');
  }

  async init(): Promise<void> {
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
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as NodeJS.ErrnoException).code
          : undefined;
      if (code === 'ENOENT') {
        this.tasks = [];
        return;
      }
      throw err;
    }
  }

  async getAll(): Promise<Task[]> {
    return this.tasks;
  }

  async create(input: { title: string; agent: Agent }): Promise<Task> {
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      status: 'backlog',
      agent: input.agent,
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(task);
    await this.save();
    return task;
  }

  async update(
    id: string,
    patch: Partial<Pick<Task, 'title' | 'status' | 'agent'>>,
  ): Promise<Task> {
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new Error(`Task not found: ${id}`);
    }
    const current = this.tasks[index];
    const updated: Task = {
      ...current,
      ...patch,
    };
    this.tasks[index] = updated;
    await this.save();
    return updated;
  }

  async delete(id: string): Promise<void> {
    const next = this.tasks.filter((t) => t.id !== id);
    if (next.length === this.tasks.length) {
      return;
    }
    this.tasks = next;
    await this.save();
  }

  private async save(): Promise<void> {
    const tmpPath = `${this.filePath}.tmp`;
    const payload = `${JSON.stringify(this.tasks, null, 2)}\n`;
    await fs.writeFile(tmpPath, payload, 'utf8');
    if (process.platform === 'win32') {
      try {
        await fs.unlink(this.filePath);
      } catch (err: unknown) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? (err as NodeJS.ErrnoException).code
            : undefined;
        if (code !== 'ENOENT') {
          throw err;
        }
      }
    }
    await fs.rename(tmpPath, this.filePath);
  }
}
