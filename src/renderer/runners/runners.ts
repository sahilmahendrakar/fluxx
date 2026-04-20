import {
  collectionGroup,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  doc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { RunnerStatus } from '../../types';
import { getFirebaseFirestore } from '../firebase';

/** A single runner row observed via the realtime snapshot. */
export interface RunnerEntry {
  taskId: string;
  uid: string;
  status: RunnerStatus;
  lastSeen: string;
  displayName?: string;
}

/**
 * Subscribes to every `runners/*` doc under `projects/{pid}/tasks/{*}`. We use
 * collectionGroup('runners') filtered by project id so one listener covers all
 * tasks in the project — cheaper than one listener per task.
 *
 * The `projectId` filter assumes we store it in the runner doc payload so the
 * group query can partition by project (collection-group queries span ALL
 * ancestors).
 */
export function subscribeToRunners(
  projectId: string,
  cb: (rows: RunnerEntry[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const db = getFirebaseFirestore();
  const q = query(
    collectionGroup(db, 'runners'),
    where('projectId', '==', projectId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map(toRunnerEntry).filter((r): r is RunnerEntry => r !== null);
      cb(rows);
    },
    (err) => {
      console.error('[runners] snapshot error', err);
      onError?.(err);
    },
  );
}

function toRunnerEntry(
  d: QueryDocumentSnapshot<DocumentData>,
): RunnerEntry | null {
  // Path: projects/{pid}/tasks/{tid}/runners/{uid}
  const parts = d.ref.path.split('/');
  if (parts.length !== 6 || parts[0] !== 'projects' || parts[2] !== 'tasks' || parts[4] !== 'runners') {
    return null;
  }
  const taskId = parts[3];
  const uid = parts[5];
  const data = d.data() ?? {};
  const status: RunnerStatus =
    data.status === 'running' || data.status === 'idle' || data.status === 'errored'
      ? (data.status as RunnerStatus)
      : 'idle';
  return {
    taskId,
    uid,
    status,
    lastSeen: tsToIso(data.lastSeen) ?? new Date().toISOString(),
    displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
  };
}

function tsToIso(ts: unknown): string | undefined {
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  return undefined;
}

export async function writeRunner(
  projectId: string,
  taskId: string,
  uid: string,
  status: RunnerStatus,
  displayName?: string,
): Promise<void> {
  const db = getFirebaseFirestore();
  const ref = doc(db, 'projects', projectId, 'tasks', taskId, 'runners', uid);
  await setDoc(
    ref,
    {
      projectId,
      status,
      lastSeen: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(displayName ? { displayName } : {}),
    },
    { merge: true },
  );
}
