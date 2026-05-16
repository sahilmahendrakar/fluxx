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
import { COLUMNS, type Agent, type Task, type TaskAttachedPlanningDoc, type TaskGithubPr, type TaskStatus } from '../../types';
import { parsePersistedTaskAttachedPlanningDocs, sanitizeTaskAttachedPlanningDocsInput } from '../../taskAttachedPlanningDocs';
import { parseGithubPrField } from '../../githubPrMetadata';
import { validateBlockedByTaskIds } from '../../taskDependencies';
import { normalizeTaskLabels } from '../../taskLabels';
import {
  planTaskSourceBranchFieldsForCreate,
  validateStoredTaskSourceBranchName,
} from '../../taskBranches';
import {
  nextPersistedRepoIdAfterPatch,
  resolveLocalTaskRepoIdForCreate,
  resolvePrimaryRepoIdFromList,
  validateTaskRepoIdPatchValue,
} from '../../repoIdentity';
import { getFirebaseFirestore } from '../firebase';
import type {
  TaskCreateInput,
  TaskPatch,
  TaskProvider,
} from './TaskProvider';

const KNOWN_STATUSES: TaskStatus[] = COLUMNS.map((c) => c.id);
const AGENTS: Agent[] = ['claude-code', 'codex', 'cursor'];

/**
 * Realtime Firestore-backed provider for a single cloud project. Reads via
 * onSnapshot on `projects/{pid}/tasks`; writes single doc via updateDoc.
 */
export class FirestoreTaskProvider implements TaskProvider {
  private projectId: string;
  private uid: string;
  /** Latest shared cloud repos for id validation (from {@link CloudProject.sharedRepos}). */
  private getSharedRepos: () => ReadonlyArray<{ id: string }>;
  private subscribers = new Set<(tasks: Task[]) => void>();
  private tasks: Task[] = [];
  private unsubSnapshot: (() => void) | null = null;

  constructor(
    projectId: string,
    uid: string,
    getSharedRepos: () => ReadonlyArray<{ id: string }>,
  ) {
    this.projectId = projectId;
    this.uid = uid;
    this.getSharedRepos = getSharedRepos;
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
        const primaryRepoId = resolvePrimaryRepoIdFromList(this.getSharedRepos());
        this.tasks = snap.docs.map((d) => toTask(d, this.projectId, primaryRepoId));
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
    const trimmedRepoId =
      input.repoId !== undefined && String(input.repoId).trim() !== ''
        ? String(input.repoId).trim()
        : undefined;
    const disc = await window.electronAPI.repo.getBranchDiscovery(
      trimmedRepoId !== undefined ? { repoId: trimmedRepoId } : undefined,
    );
    if ('error' in disc) {
      throw new Error(disc.error);
    }
    const planned = planTaskSourceBranchFieldsForCreate(disc, {
      sourceBranch: input.sourceBranch,
      createSourceBranchIfMissing: input.createSourceBranchIfMissing,
    });
    const branchOk = validateStoredTaskSourceBranchName(planned.sourceBranch);
    if (!branchOk.ok) {
      throw new Error(branchOk.message);
    }
    const repos = this.getSharedRepos();
    const repoResolved = resolveLocalTaskRepoIdForCreate(repos, input.repoId);
    if (!repoResolved.ok) {
      throw new Error(repoResolved.message);
    }
    const data = {
      title: input.title,
      status: input.status ?? ('backlog' as TaskStatus),
      agent: input.agent === null ? null : input.agent,
      repoId: repoResolved.repoId,
      createdAt: serverTimestamp(),
      createdBy: this.uid,
      updatedAt: serverTimestamp(),
      updatedBy: this.uid,
      sourceBranch: planned.sourceBranch,
      createSourceBranchIfMissing: planned.createSourceBranchIfMissing,
      ...(input.orderKey !== undefined ? { orderKey: input.orderKey } : {}),
      ...(createLabels.length > 0 ? { labels: createLabels } : {}),
      ...(input.assigneeId !== undefined && input.assigneeId !== ''
        ? { assigneeId: input.assigneeId }
        : {}),
      ...(input.agent != null &&
      input.agentModel !== undefined &&
      String(input.agentModel).trim() !== ''
        ? { agentModel: input.agentModel.trim() }
        : {}),
      ...(input.agent != null && input.agentYolo === true ? { agentYolo: true } : {}),
      ...(input.attachedPlanningDocs !== undefined
        ? (() => {
            const s = sanitizeTaskAttachedPlanningDocsInput(input.attachedPlanningDocs);
            return s.length > 0 ? { attachedPlanningDocs: s } : {};
          })()
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
      sourceBranch: planned.sourceBranch,
      createSourceBranchIfMissing: planned.createSourceBranchIfMissing,
      ...(input.orderKey !== undefined ? { orderKey: input.orderKey } : {}),
      ...(createLabels.length > 0 ? { labels: createLabels } : {}),
      ...(normalizedDeps ? { blockedByTaskIds: normalizedDeps } : {}),
      ...(input.assigneeId !== undefined && input.assigneeId !== ''
        ? { assigneeId: input.assigneeId }
        : {}),
      ...(input.agent != null &&
      input.agentModel !== undefined &&
      String(input.agentModel).trim() !== ''
        ? { agentModel: input.agentModel.trim() }
        : {}),
      ...(input.agent != null && input.agentYolo === true ? { agentYolo: true } : {}),
      repoId: repoResolved.repoId,
      ...(() => {
        if (input.attachedPlanningDocs === undefined) return {};
        const s = sanitizeTaskAttachedPlanningDocsInput(input.attachedPlanningDocs);
        return s.length > 0 ? { attachedPlanningDocs: s } : {};
      })(),
    };
  }

  async update(id: string, patch: TaskPatch): Promise<Task> {
    const previous = this.tasks.find((t) => t.id === id);
    if (!previous) {
      throw new Error(`Task not found: ${id}`);
    }
    if (patch.sourceBranch !== undefined || patch.createSourceBranchIfMissing !== undefined) {
      const gate = await window.electronAPI.tasks.assertSourceBranchEditable(
        id,
        {
          sourceBranch: previous.sourceBranch,
          createSourceBranchIfMissing: previous.createSourceBranchIfMissing,
          githubPr: previous.githubPr,
          fluxWorkBranch: previous.fluxWorkBranch,
          ...(previous.repoId !== undefined ? { repoId: previous.repoId } : {}),
        },
        {
          ...(patch.sourceBranch !== undefined ? { sourceBranch: patch.sourceBranch } : {}),
          ...(patch.createSourceBranchIfMissing !== undefined
            ? { createSourceBranchIfMissing: patch.createSourceBranchIfMissing }
            : {}),
          ...(patch.repoId !== undefined ? { repoId: patch.repoId } : {}),
        },
      );
      if (!gate.ok) {
        throw new Error(gate.message);
      }
    }
    if (patch.repoId !== undefined) {
      const vr = validateTaskRepoIdPatchValue(this.getSharedRepos(), patch.repoId);
      if (!vr.ok) {
        throw new Error(vr.message);
      }
      const gate = await window.electronAPI.tasks.assertRepoIdEditable(
        id,
        {
          repoId: previous.repoId,
          githubPr: previous.githubPr,
          fluxWorkBranch: previous.fluxWorkBranch,
        },
        {
          ...(patch.repoId !== undefined ? { repoId: patch.repoId } : {}),
        },
      );
      if (!gate.ok) {
        throw new Error(gate.message);
      }
    }
    const db = getFirebaseFirestore();
    const ref = doc(db, 'projects', this.projectId, 'tasks', id);
    const updates: DocumentData = {
      updatedAt: serverTimestamp(),
      updatedBy: this.uid,
    };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.agent !== undefined) {
      if (patch.agent === null) {
        updates.agent = null;
        updates.agentModel = deleteField();
        updates.agentYolo = deleteField();
      } else {
        updates.agent = patch.agent;
      }
    }
    const nextAgent = patch.agent !== undefined ? patch.agent : previous.agent;
    if (patch.agentModel !== undefined && nextAgent !== null) {
      updates.agentModel = patch.agentModel;
    }
    if (patch.agentYolo !== undefined && nextAgent !== null) {
      updates.agentYolo = patch.agentYolo;
    }
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
      if (patch.autoStartOnUnblock === null) {
        updates.autoStartOnUnblock = deleteField();
      } else {
        updates.autoStartOnUnblock = patch.autoStartOnUnblock;
      }
    }
    if (patch.assigneeId !== undefined) {
      if (
        patch.assigneeId === null ||
        (typeof patch.assigneeId === 'string' && patch.assigneeId.trim() === '')
      ) {
        updates.assigneeId = deleteField();
      } else {
        updates.assigneeId =
          typeof patch.assigneeId === 'string' ? patch.assigneeId.trim() : patch.assigneeId;
      }
    }
    if (patch.githubPr !== undefined) {
      if (patch.githubPr === null) {
        updates.githubPr = deleteField();
      } else {
        updates.githubPr = githubPrToFirestore(patch.githubPr);
      }
    }
    if (patch.sourceBranch !== undefined) {
      const b = patch.sourceBranch.trim();
      if (b.length === 0) {
        updates.sourceBranch = deleteField();
      } else {
        updates.sourceBranch = b;
      }
    }
    if (patch.createSourceBranchIfMissing !== undefined) {
      if (patch.createSourceBranchIfMissing) {
        updates.createSourceBranchIfMissing = true;
      } else {
        updates.createSourceBranchIfMissing = deleteField();
      }
    }
    if (patch.repoId !== undefined) {
      const nextRepoId = nextPersistedRepoIdAfterPatch(previous.repoId, patch.repoId);
      if (nextRepoId === undefined) {
        updates.repoId = deleteField();
      } else {
        updates.repoId = nextRepoId;
      }
    }
    if (patch.fluxWorkBranch !== undefined) {
      const b = patch.fluxWorkBranch.trim();
      if (b.length === 0) {
        updates.fluxWorkBranch = deleteField();
      } else {
        updates.fluxWorkBranch = b;
      }
    }
    if (patch.attachedPlanningDocs !== undefined) {
      if (patch.attachedPlanningDocs === null) {
        updates.attachedPlanningDocs = deleteField();
      } else {
        const s = sanitizeTaskAttachedPlanningDocsInput(patch.attachedPlanningDocs);
        if (s.length > 0) {
          updates.attachedPlanningDocs = s;
        } else {
          updates.attachedPlanningDocs = deleteField();
        }
      }
    }
    await updateDoc(ref, updates);
    const after = await getDoc(ref);
    return toTask(
      after as unknown as QueryDocumentSnapshot<DocumentData>,
      this.projectId,
      resolvePrimaryRepoIdFromList(this.getSharedRepos()),
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
  primaryRepoId: string | undefined,
): Task {
  const data = d.data() ?? {};
  const status =
    typeof data.status === 'string' &&
    (KNOWN_STATUSES as string[]).includes(data.status)
      ? (data.status as TaskStatus)
      : 'backlog';
  const agent: Agent | null =
    data.agent === null
      ? null
      : typeof data.agent === 'string' && (AGENTS as string[]).includes(data.agent)
        ? (data.agent as Agent)
        : 'claude-code';
  return {
    id: d.id,
    title: typeof data.title === 'string' ? data.title : '',
    status,
    agent,
    agentModel:
      agent != null &&
      typeof data.agentModel === 'string' &&
      data.agentModel.trim() !== ''
        ? data.agentModel.trim()
        : undefined,
    agentYolo:
      agent != null && typeof data.agentYolo === 'boolean' ? data.agentYolo : undefined,
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
    ...parseGithubPrFirestoreField(data.githubPr),
    ...parseSourceBranchField(data.sourceBranch),
    ...parseCreateSourceBranchIfMissingField(data.createSourceBranchIfMissing),
    ...parseRepoIdField(data.repoId, primaryRepoId),
    ...parseFluxWorkBranchField(data.fluxWorkBranch),
    ...parseAttachedPlanningDocsField(data.attachedPlanningDocs),
  };
}

function parseAttachedPlanningDocsField(
  val: unknown,
): { attachedPlanningDocs: TaskAttachedPlanningDoc[] } | Record<string, never> {
  const parsed = parsePersistedTaskAttachedPlanningDocs(val);
  if (!parsed) {
    return {};
  }
  return { attachedPlanningDocs: parsed };
}

function parseFluxWorkBranchField(
  val: unknown,
): { fluxWorkBranch: string } | Record<string, never> {
  if (typeof val === 'string' && val.trim() !== '') {
    return { fluxWorkBranch: val.trim() };
  }
  return {};
}

function githubPrToFirestore(pr: TaskGithubPr): Record<string, unknown> {
  const out: Record<string, unknown> = { url: pr.url };
  if (pr.number !== undefined) out.number = pr.number;
  if (pr.state !== undefined) out.state = pr.state;
  if (pr.mergedAt !== undefined) out.mergedAt = pr.mergedAt;
  if (pr.headBranch !== undefined) out.headBranch = pr.headBranch;
  if (pr.baseBranch !== undefined) out.baseBranch = pr.baseBranch;
  if (pr.createdAt !== undefined) out.createdAt = pr.createdAt;
  if (pr.updatedAt !== undefined) out.updatedAt = pr.updatedAt;
  return out;
}

function parseGithubPrFirestoreField(
  val: unknown,
): { githubPr: TaskGithubPr } | Record<string, never> {
  const parsed = parseGithubPrField(val);
  if (!parsed) return {};
  return { githubPr: parsed };
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
): { autoStartOnUnblock: true } | { autoStartOnUnblock: false } | Record<string, never> {
  if (val === true) {
    return { autoStartOnUnblock: true };
  }
  if (val === false) {
    return { autoStartOnUnblock: false };
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

function parseSourceBranchField(
  val: unknown,
): { sourceBranch: string } | Record<string, never> {
  if (typeof val !== 'string' || val.trim() === '') {
    return {};
  }
  return { sourceBranch: val.trim() };
}

function parseCreateSourceBranchIfMissingField(
  val: unknown,
): { createSourceBranchIfMissing: boolean } | Record<string, never> {
  if (val === true) return { createSourceBranchIfMissing: true };
  if (val === false) return { createSourceBranchIfMissing: false };
  return {};
}

/** Legacy tasks without `repoId` resolve to the primary shared repo for display/filtering. */
function parseRepoIdField(
  raw: unknown,
  primaryRepoId: string | undefined,
): { repoId: string } | Record<string, never> {
  if (typeof raw === 'string' && raw.trim() !== '') {
    return { repoId: raw.trim() };
  }
  if (primaryRepoId !== undefined && primaryRepoId.trim() !== '') {
    return { repoId: primaryRepoId.trim() };
  }
  return {};
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
