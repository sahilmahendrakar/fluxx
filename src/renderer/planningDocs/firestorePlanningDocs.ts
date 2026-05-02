import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
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
    const data = d.data();
    if (data?.schemaVersion !== 1) continue;
    if (typeof data.relativePath !== 'string' || typeof data.markdown !== 'string') continue;
    out.set(data.relativePath, data.markdown);
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
