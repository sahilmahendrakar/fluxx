import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, type QueryDocumentSnapshot } from 'firebase/firestore';
import type { FirestorePlanningDocDocumentV1 } from '../../planningDocs/types';
import type { PlanningDocsFirestoreDocPayload } from '../../planningDocs/syncTypes';
import {
  normalizePlanningDocRelativePath,
  planningRelativePathToFirestoreDocId,
} from '../../planningDocs/path';
import { revisionFromFirestoreUpdatedAt } from '../../planningDocs/firestoreRevision';
import { getFirebaseFirestore, isFirebaseConfigured } from '../firebase';

function parsePlanningDocSnapshot(snapshot: QueryDocumentSnapshot): PlanningDocsFirestoreDocPayload | null {
  const data = snapshot.data() as Partial<FirestorePlanningDocDocumentV1>;
  if (data.schemaVersion !== 1) return null;
  if (typeof data.relativePath !== 'string' || typeof data.markdown !== 'string') return null;
  const norm = normalizePlanningDocRelativePath(data.relativePath);
  if (!norm) return null;
  const expectedId = planningRelativePathToFirestoreDocId(norm);
  if (!expectedId || expectedId !== snapshot.id) return null;
  return {
    docId: snapshot.id,
    relativePath: norm,
    markdown: data.markdown,
    remoteRevision: revisionFromFirestoreUpdatedAt(data.updatedAt),
  };
}

export type PlanningDocsFirestoreStreamState =
  | { kind: 'disabled' }
  | { kind: 'connecting' }
  | { kind: 'live'; fromCache: boolean }
  | { kind: 'error'; message: string };

export type PlanningDocsFirestoreSyncArgs = {
  enabled: boolean;
  projectId: string | null;
};

/**
 * Subscribes to `projects/{projectId}/planningDocs` and mirrors remote markdown
 * into the local `planning/docs/` tree via main-process IPC (canonical when remote
 * has documents; empty remote does not delete local-only files).
 */
export function usePlanningDocsFirestoreSync(
  args: PlanningDocsFirestoreSyncArgs,
): PlanningDocsFirestoreStreamState {
  const { enabled, projectId } = args;
  const prevIdsRef = useRef<Set<string>>(new Set());
  const [stream, setStream] = useState<PlanningDocsFirestoreStreamState>({ kind: 'disabled' });

  useEffect(() => {
    prevIdsRef.current = new Set();
  }, [projectId]);

  useEffect(() => {
    if (!enabled || !projectId || !isFirebaseConfigured()) {
      setStream({ kind: 'disabled' });
      return;
    }

    setStream({ kind: 'connecting' });

    const db = getFirebaseFirestore();
    const col = collection(db, 'projects', projectId, 'planningDocs');

    const unsub = onSnapshot(
      col,
      (snap) => {
        setStream({ kind: 'live', fromCache: snap.metadata.fromCache });
        const docs: Array<{
          docId: string;
          relativePath: string;
          markdown: string;
          remoteRevision: string;
        }> = [];
        const currentIds = new Set<string>();
        for (const d of snap.docs) {
          currentIds.add(d.id);
          const parsed = parsePlanningDocSnapshot(d);
          if (parsed) docs.push(parsed);
        }
        const prev = prevIdsRef.current;
        const removedDocIds = [...prev].filter((id) => !currentIds.has(id));
        prevIdsRef.current = currentIds;

        void window.electronAPI.planningDocs
          .applyFirestoreSnapshot({ projectId, docs, removedDocIds })
          .then((r) => {
            if (!r.ok && r.code !== 'PROJECT_MISMATCH') {
              console.warn('[usePlanningDocsFirestoreSync] apply failed', r);
            }
          });
      },
      (err) => {
        console.error('[usePlanningDocsFirestoreSync] snapshot error', err);
        setStream({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      },
    );

    return () => unsub();
  }, [enabled, projectId]);

  return stream;
}
