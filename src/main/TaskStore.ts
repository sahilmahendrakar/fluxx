import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Agent, Task, TaskAttachedPlanningDoc, TaskGithubPr } from '../types';
import { DEFAULT_CURSOR_AGENT_MODEL } from '../types';
import { sanitizeTaskAttachedPlanningDocsInput } from '../taskAttachedPlanningDocs';
import { validateBlockedByTaskIds, taskIdsToClearAutoStartOnUnblockWhenAutomationEnables } from '../taskDependencies';
import { normalizeTaskLabels } from '../taskLabels';

type TaskInput = {
  title: string;
  agent: Agent;
  projectId: string;
  blockedByTaskIds?: string[];
  labels?: string[];
  sourceBranch?: string;
  createSourceBranchIfMissing?: boolean;
  agentModel?: string;
  agentYolo?: boolean;
  /** Multi-repo2: identity of the {@link RepoConfig} this task belongs to. Optional — falls back to primary. */
  repoId?: string;
  attachedPlanningDocs?: TaskAttachedPlanningDoc[];
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

  /**
   * Multi-repo2 migration: assign a primary `repoId` to tasks that predate
   * the multi-repo data model, then persist if any rows changed. Idempotent
   * — running on already-migrated tasks is a no-op.
   */
  async migrateMissingRepoIds(primaryRepoId: string): Promise<void> {
    if (!this.filePath) return;
    if (!primaryRepoId) return;
    let changed = false;
    this.tasks = this.tasks.map((t) => {
      if (t.repoId == null || t.repoId === '') {
        changed = true;
        return { ...t, repoId: primaryRepoId };
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

  /**
   * When project “auto-start when unblocked” is turned on, drop per-task `autoStartOnUnblock`
   * on blocked tasks so prior opt-in/opt-out choices are not carried over.
   */
  async bulkClearAutoStartOnUnblockForBlockedTasks(projectId: string): Promise<number> {
    if (!this.filePath) {
      return 0;
    }
    const ids = new Set(taskIdsToClearAutoStartOnUnblockWhenAutomationEnables(this.getAll(projectId)));
    if (ids.size === 0) {
      return 0;
    }
    let cleared = 0;
    this.tasks = this.tasks.map((t) => {
      if (!ids.has(t.id) || t.autoStartOnUnblock === undefined) {
        return t;
      }
      const next = { ...t };
      delete next.autoStartOnUnblock;
      cleared += 1;
      return next;
    });
    if (cleared > 0) {
      await this.save();
    }
    return cleared;
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
    if (input.sourceBranch != null && input.sourceBranch.trim().length > 0) {
      task.sourceBranch = input.sourceBranch.trim();
    }
    if (input.createSourceBranchIfMissing === true) {
      task.createSourceBranchIfMissing = true;
    } else if (input.createSourceBranchIfMissing === false) {
      task.createSourceBranchIfMissing = false;
    }
    if (input.agent === 'cursor') {
      const m = (input.agentModel ?? '').trim() || DEFAULT_CURSOR_AGENT_MODEL;
      task.agentModel = m;
    } else if (input.agent === 'claude-code' && (input.agentModel ?? '').trim()) {
      task.agentModel = (input.agentModel ?? '').trim();
    }
    if (input.agentYolo === true) {
      task.agentYolo = true;
    }
    if (input.repoId != null && input.repoId.length > 0) {
      task.repoId = input.repoId;
    }
    if (input.attachedPlanningDocs !== undefined) {
      const s = sanitizeTaskAttachedPlanningDocsInput(input.attachedPlanningDocs);
      if (s.length > 0) {
        task.attachedPlanningDocs = s;
      }
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
        | 'sourceBranch'
        | 'createSourceBranchIfMissing'
        | 'repoId'
        | 'fluxWorkBranch'
      >
    > & {
      autoStartOnUnblock?: boolean | null;
      assigneeId?: string | null;
      githubPr?: TaskGithubPr | null;
      /** `null` clears stored attachments. */
      attachedPlanningDocs?: TaskAttachedPlanningDoc[] | null;
    },
  ): Promise<Task> {
    if (!this.filePath) {
      throw new Error('No project directory open for tasks');
    }
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new Error(`Task not found: ${id}`);
    }
    const current = this.tasks[index];
    const {
      assigneeId: patchAssigneeId,
      githubPr: patchGithubPr,
      autoStartOnUnblock: patchAsou,
      attachedPlanningDocs: patchAttachedDocs,
      ...patchRest
    } = patch;
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
    if (patchAsou !== undefined) {
      if (patchAsou === null) {
        delete updated.autoStartOnUnblock;
      } else {
        updated.autoStartOnUnblock = patchAsou;
      }
    }
    if (patchAssigneeId !== undefined) {
      if (patchAssigneeId === null || patchAssigneeId === '') {
        delete updated.assigneeId;
      } else {
        updated.assigneeId = patchAssigneeId;
      }
    }
    if (patchGithubPr !== undefined) {
      if (patchGithubPr === null) {
        delete updated.githubPr;
      } else {
        updated.githubPr = patchGithubPr;
      }
    }
    if (patchAttachedDocs !== undefined) {
      if (patchAttachedDocs === null) {
        delete updated.attachedPlanningDocs;
      } else {
        const s = sanitizeTaskAttachedPlanningDocsInput(patchAttachedDocs);
        if (s.length > 0) {
          updated.attachedPlanningDocs = s;
        } else {
          delete updated.attachedPlanningDocs;
        }
      }
    }
    if (patch.sourceBranch !== undefined) {
      const b = patch.sourceBranch.trim();
      if (b.length === 0) {
        delete updated.sourceBranch;
      } else {
        updated.sourceBranch = b;
      }
    }
    if (patch.createSourceBranchIfMissing !== undefined) {
      if (patch.createSourceBranchIfMissing) {
        updated.createSourceBranchIfMissing = true;
      } else {
        delete updated.createSourceBranchIfMissing;
      }
    }
    if (patch.repoId !== undefined) {
      const nextRepo = (patch.repoId ?? '').trim();
      if (nextRepo.length === 0) {
        delete updated.repoId;
      } else {
        updated.repoId = nextRepo;
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
