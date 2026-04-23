import {
  addDoc,
  collection,
  deleteDoc,
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
    const data = {
      title: input.title,
      status: input.status ?? ('backlog' as TaskStatus),
      agent: input.agent,
      createdAt: serverTimestamp(),
      createdBy: this.uid,
      updatedAt: serverTimestamp(),
      updatedBy: this.uid,
      ...(input.orderKey !== undefined ? { orderKey: input.orderKey } : {}),
    };
    const ref = await addDoc(col, data);
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
  };
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
