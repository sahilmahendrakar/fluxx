import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import type { FirestorePlanningDocDocumentV1 } from '../../planningDocs/types';
import type { PlanningDocsConflictRecordV1 } from '../../planningDocs/syncTypes';
import {
  parseFirestorePlanningDocListRow,
  parsePlanningDocSnapshotForPush,
} from '../../planningDocs/firestorePlanningDocParse';
import { revisionFromFirestoreUpdatedAt } from '../../planningDocs/firestoreRevision';
import { planningRelativePathToFirestoreDocId } from '../../planningDocs/path';
import { getFirebaseFirestore } from '../firebase';

/**
 * Reads all planning markdown docs from `projects/{projectId}/planningDocs`.
 * Invalid legacy rows are skipped.
 */
export async function fetchFirestorePlanningDocsMarkdown(
  projectId: string,
): Promise<Map<string, string>> {
  const db = getFirebaseFirestore();
  const snap = await getDocs(collection(db, 'projects', projectId, 'planningDocs'));
  const out = new Map<string, string>();
  for (const d of snap.docs) {
    const row = parseFirestorePlanningDocListRow(d.data());
    if (!row) continue;
    out.set(row.relativePath, row.markdown);
  }
  return out;
}

const BATCH_MAX = 400;

/** Uploads or overwrites planning docs (explicit seed / user-initiated merge only). */
export async function upsertFirestorePlanningDocs(
  projectId: string,
  uid: string,
  files: { relativePath: string; markdown: string }[],
): Promise<void> {
  const db = getFirebaseFirestore();
  for (let i = 0; i < files.length; i += BATCH_MAX) {
    const batch = writeBatch(db);
    const slice = files.slice(i, i + BATCH_MAX);
    for (const f of slice) {
      const docId = planningRelativePathToFirestoreDocId(f.relativePath);
      if (!docId) {
        throw new Error(`Invalid planning path for Firestore: ${f.relativePath}`);
      }
      const ref = doc(db, 'projects', projectId, 'planningDocs', docId);
      batch.set(ref, {
        schemaVersion: 1,
        relativePath: f.relativePath,
        markdown: f.markdown,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
    }
    await batch.commit();
  }
}

export type PlanningDocPushExpectation =
  | { kind: 'absent' }
  | { kind: 'revision'; remoteRevision: string };

export type PlanningDocPushToFirestoreResult =
  | { ok: true; newRemoteRevision: string }
  | {
      ok: false;
      reason: 'remote_changed';
      remoteRevision: string;
      remoteMarkdown: string;
      remoteUpdatedBy: string;
    }
  | { ok: false; reason: 'remote_missing' };

/**
 * Atomically writes planning markdown when the remote revision matches the local base,
 * or when creating a doc that does not yet exist remotely (`kind: 'absent'`).
 */
export async function pushPlanningDocToFirestore(
  projectId: string,
  uid: string,
  relativePath: string,
  markdown: string,
  expectation: PlanningDocPushExpectation,
): Promise<PlanningDocPushToFirestoreResult> {
  const db = getFirebaseFirestore();
  const docId = planningRelativePathToFirestoreDocId(relativePath);
  if (!docId) {
    throw new Error(`Invalid planning path for Firestore: ${relativePath}`);
  }
  const ref = doc(db, 'projects', projectId, 'planningDocs', docId);

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (expectation.kind === 'absent') {
        if (snap.exists()) {
          const cur = parsePlanningDocSnapshotForPush(snap.data() as Partial<FirestorePlanningDocDocumentV1>);
          throw Object.assign(new Error('planning_doc_push_conflict'), {
            code: 'planning_doc_push_conflict' as const,
            payload: cur,
          });
        }
        transaction.set(ref, {
          schemaVersion: 1,
          relativePath,
          markdown,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        });
        return;
      }

      if (!snap.exists()) {
        throw Object.assign(new Error('planning_doc_remote_missing'), {
          code: 'planning_doc_remote_missing' as const,
        });
      }

      const cur = parsePlanningDocSnapshotForPush(snap.data() as Partial<FirestorePlanningDocDocumentV1>);
      if (cur.revision !== expectation.remoteRevision) {
        throw Object.assign(new Error('planning_doc_push_conflict'), {
          code: 'planning_doc_push_conflict' as const,
          payload: cur,
        });
      }

      transaction.set(ref, {
        schemaVersion: 1,
        relativePath,
        markdown,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
    });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'planning_doc_push_conflict' &&
      'payload' in err
    ) {
      const p = (err as { payload: { revision: string; markdown: string; updatedBy: string } }).payload;
      return {
        ok: false,
        reason: 'remote_changed',
        remoteRevision: p.revision,
        remoteMarkdown: p.markdown,
        remoteUpdatedBy: p.updatedBy,
      };
    }
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'planning_doc_remote_missing'
    ) {
      return { ok: false, reason: 'remote_missing' };
    }
    throw err;
  }

  const after = await getDoc(ref);
  const data = after.data() as Partial<FirestorePlanningDocDocumentV1> | undefined;
  const newRemoteRevision = revisionFromFirestoreUpdatedAt(data?.updatedAt);
  return { ok: true, newRemoteRevision };
}

const CONFLICT_DOC_SCHEMA = 1;

/** Append conflict diagnostics for teammates (`planningDocs/{docId}/conflicts/*`). */
export async function appendPlanningDocFirestoreConflict(
  projectId: string,
  docId: string,
  record: PlanningDocsConflictRecordV1,
): Promise<void> {
  const db = getFirebaseFirestore();
  const conflicts = collection(db, 'projects', projectId, 'planningDocs', docId, 'conflicts');
  await addDoc(conflicts, {
    schemaVersion: CONFLICT_DOC_SCHEMA,
    relativePath: record.relativePath,
    createdAt: serverTimestamp(),
    baseRemoteRevision: record.baseRemoteRevision,
    localMarkdown: record.localMarkdown,
    remoteMarkdown: record.remoteMarkdown,
    remoteRevision: record.remoteRevision,
    remoteUpdatedBy: record.remoteUpdatedBy,
    localUpdatedBy: record.localUpdatedBy,
  });
}
