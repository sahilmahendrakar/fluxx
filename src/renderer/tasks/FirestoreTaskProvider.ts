import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { Agent, Task, TaskStatus } from '../../types';
import { validateBlockedByTaskIds } from '../../taskDependencies';
import { normalizeTaskLabels } from '../../taskLabels';
import { getFirebaseFirestore } from '../firebase';
import type {
  TaskCreateInput,
  TaskPatch,
  TaskProvider,
} from './TaskProvider';

const COLUMNS: TaskStatus[] = ['backlog', 'in-progress', 'needs-input', 'done'];
const AGENTS: Agent[] = ['claude-code', 'codex', 'cursor'];

/**
 * Realtime Firestore-backed provider for a single cloud project. Reads via
 * onSnapshot on `projects/{pid}/tasks`; writes single doc via updateDoc.
 */
export class FirestoreTaskProvider implements TaskProvider {
  private projectId: string;
  private uid: string;
  private subscribers = new Set<(tasks: Task[]) => void>();
  private tasks: Task[] = [];
  private unsubSnapshot: (() => void) | null = null;

  constructor(projectId: string, uid: string) {
    this.projectId = projectId;
    this.uid = uid;
  }

  subscribe(cb: (tasks: Task[]) => void): () => void {
    this.subscribers.add(cb);
    cb(this.tasks);
    if (!this.unsubSnapshot) this.startSnapshot();
    return () => {
      this.subscribers.delete(cb);
      if (this.subscribers.size === 0) {
        this.unsubSnapshot?.();
        this.unsubSnapshot = null;
      }
    };
  }

  private startSnapshot(): void {
    const db = getFirebaseFirestore();
    const col = collection(db, 'projects', this.projectId, 'tasks');
    this.unsubSnapshot = onSnapshot(
      col,
      (snap) => {
        this.tasks = snap.docs.map((d) => toTask(d, this.projectId));
        const out = this.tasks.slice();
        for (const cb of this.subscribers) cb(out);
      },
      (err) => {
        console.error('[FirestoreTaskProvider] snapshot error', err);
      },
    );
  }

  async create(input: TaskCreateInput): Promise<Task> {
    const db = getFirebaseFirestore();
    const col = collection(db, 'projects', this.projectId, 'tasks');
    const createLabels = normalizeTaskLabels(input.labels);
    const data = {
      title: input.title,
      status: input.status ?? ('backlog' as TaskStatus),
      agent: input.agent,
      createdAt: serverTimestamp(),
      createdBy: this.uid,
      updatedAt: serverTimestamp(),
      updatedBy: this.uid,
      ...(input.orderKey !== undefined ? { orderKey: input.orderKey } : {}),
      ...(createLabels.length > 0 ? { labels: createLabels } : {}),
      ...(input.assigneeId !== undefined && input.assigneeId !== ''
        ? { assigneeId: input.assigneeId }
        : {}),
    };
    const ref = await addDoc(col, data);
    let normalizedDeps: string[] | undefined;
    try {
      if (input.blockedByTaskIds != null && input.blockedByTaskIds.length > 0) {
        const stub: Task = {
          id: ref.id,
          title: input.title,
          status: data.status,
          agent: input.agent,
          createdAt: new Date().toISOString(),
          projectId: this.projectId,
        };
        const v = validateBlockedByTaskIds(
          ref.id,
          input.blockedByTaskIds,
          [...this.tasks, stub],
          false,
        );
        if (!v.ok) {
          throw new Error(v.message);
        }
        normalizedDeps = v.normalized;
        await updateDoc(ref, {
          blockedByTaskIds: normalizedDeps,
          updatedAt: serverTimestamp(),
          updatedBy: this.uid,
        });
      }
    } catch (err) {
      await deleteDoc(ref);
      throw err;
    }
    return {
      id: ref.id,
      title: input.title,
      status: data.status,
      agent: input.agent,
      createdAt: new Date().toISOString(),
      projectId: this.projectId,
      createdBy: this.uid,
      updatedBy: this.uid,
      updatedAt: new Date().toISOString(),
      ...(input.orderKey !== undefined ? { orderKey: input.orderKey } : {}),
      ...(createLabels.length > 0 ? { labels: createLabels } : {}),
      ...(normalizedDeps ? { blockedByTaskIds: normalizedDeps } : {}),
      ...(input.assigneeId !== undefined && input.assigneeId !== ''
        ? { assigneeId: input.assigneeId }
        : {}),
    };
  }

  async update(id: string, patch: TaskPatch): Promise<Task> {
    const db = getFirebaseFirestore();
    const ref = doc(db, 'projects', this.projectId, 'tasks', id);
    const updates: DocumentData = {
      updatedAt: serverTimestamp(),
      updatedBy: this.uid,
    };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.agent !== undefined) updates.agent = patch.agent;
    if (patch.agentModel !== undefined) updates.agentModel = patch.agentModel;
    if (patch.agentYolo !== undefined) updates.agentYolo = patch.agentYolo;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.orderKey !== undefined) updates.orderKey = patch.orderKey;
    if (patch.workspaceCleanedAt !== undefined) {
      updates.workspaceCleanedAt = patch.workspaceCleanedAt;
    }
    if (patch.blockedByTaskIds !== undefined) {
      const v = validateBlockedByTaskIds(id, patch.blockedByTaskIds, this.tasks, false);
      if (!v.ok) {
        throw new Error(v.message);
      }
      updates.blockedByTaskIds = v.normalized;
    }
    if (patch.labels !== undefined) {
      const n = normalizeTaskLabels(patch.labels);
      if (n.length > 0) {
        updates.labels = n;
      } else {
        updates.labels = deleteField();
      }
    }
    if (patch.autoStartOnUnblock !== undefined) {
      if (patch.autoStartOnUnblock) {
        updates.autoStartOnUnblock = true;
      } else {
        updates.autoStartOnUnblock = deleteField();
      }
    }
    if (patch.assigneeId !== undefined) {
      if (patch.assigneeId === null || patch.assigneeId.trim() === '') {
        updates.assigneeId = deleteField();
      } else {
        updates.assigneeId = patch.assigneeId.trim();
      }
    }
    await updateDoc(ref, updates);
    const after = await getDoc(ref);
    return toTask(
      after as unknown as QueryDocumentSnapshot<DocumentData>,
      this.projectId,
    );
  }

  async delete(id: string): Promise<void> {
    const db = getFirebaseFirestore();
    await deleteDoc(doc(db, 'projects', this.projectId, 'tasks', id));
  }
}

function toTask(
  d: QueryDocumentSnapshot<DocumentData>,
  projectId: string,
): Task {
  const data = d.data() ?? {};
  const status =
    typeof data.status === 'string' &&
    (COLUMNS as string[]).includes(data.status)
      ? (data.status as TaskStatus)
      : 'backlog';
  const agent =
    typeof data.agent === 'string' && (AGENTS as string[]).includes(data.agent)
      ? (data.agent as Agent)
      : 'claude-code';
  return {
    id: d.id,
    title: typeof data.title === 'string' ? data.title : '',
    status,
    agent,
    agentModel:
      typeof data.agentModel === 'string' && data.agentModel.trim() !== ''
        ? data.agentModel.trim()
        : undefined,
    agentYolo: typeof data.agentYolo === 'boolean' ? data.agentYolo : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
    createdAt: tsToIso(data.createdAt) ?? new Date().toISOString(),
    projectId,
    orderKey: typeof data.orderKey === 'string' ? data.orderKey : undefined,
    workspaceCleanedAt:
      typeof data.workspaceCleanedAt === 'string' ? data.workspaceCleanedAt : undefined,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    updatedAt: tsToIso(data.updatedAt),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    ...parseAssigneeIdField(data.assigneeId),
    ...parseBlockedByTaskIdsField(data.blockedByTaskIds),
    ...parseLabelsField(data.labels),
    ...parseAutoStartOnUnblockField(data.autoStartOnUnblock),
  };
}

function parseAssigneeIdField(
  val: unknown,
): { assigneeId: string } | Record<string, never> {
  if (typeof val !== 'string' || val.trim() === '') {
    return {};
  }
  return { assigneeId: val.trim() };
}

function parseAutoStartOnUnblockField(
  val: unknown,
): { autoStartOnUnblock: true } | Record<string, never> {
  if (val === true) {
    return { autoStartOnUnblock: true };
  }
  return {};
}

function parseLabelsField(
  val: unknown,
): { labels: string[] } | Record<string, never> {
  if (!Array.isArray(val)) {
    return {};
  }
  const raw = val.filter((x): x is string => typeof x === 'string');
  const n = normalizeTaskLabels(raw);
  if (n.length === 0) {
    return {};
  }
  return { labels: n };
}

function parseBlockedByTaskIdsField(
  val: unknown,
): { blockedByTaskIds: string[] } | Record<string, never> {
  if (!Array.isArray(val)) {
    return {};
  }
  const ids = val.filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (ids.length === 0) {
    return {};
  }
  return { blockedByTaskIds: ids };
}

function tsToIso(ts: unknown): string | undefined {
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (ts && typeof ts === 'object' && 'seconds' in ts) {
    try {
      return new Date((ts as { seconds: number }).seconds * 1000).toISOString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}
