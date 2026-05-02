import { useEffect, useRef } from 'react';
import { collection, onSnapshot, type QueryDocumentSnapshot } from 'firebase/firestore';
import type { FirestorePlanningDocDocumentV1 } from '../../planningDocs/types';
import type { PlanningDocsFirestoreDocPayload } from '../../planningDocs/syncTypes';
import {
  normalizePlanningDocRelativePath,
  planningRelativePathToFirestoreDocId,
} from '../../planningDocs/path';
import { getFirebaseFirestore, isFirebaseConfigured } from '../firebase';

function revisionFromUpdatedAt(updatedAt: unknown): string {
  if (
    updatedAt &&
    typeof updatedAt === 'object' &&
    'seconds' in updatedAt &&
    typeof (updatedAt as { seconds: unknown }).seconds === 'number'
  ) {
    const s = (updatedAt as { seconds: number }).seconds;
    const n =
      'nanoseconds' in updatedAt && typeof (updatedAt as { nanoseconds: unknown }).nanoseconds === 'number'
        ? (updatedAt as { nanoseconds: number }).nanoseconds
        : 0;
    return `${s}_${n}`;
  }
  if (
    updatedAt &&
    typeof updatedAt === 'object' &&
    typeof (updatedAt as { toMillis?: () => number }).toMillis === 'function'
  ) {
    return `ms_${(updatedAt as { toMillis: () => number }).toMillis()}`;
  }
  return 'unknown';
}

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
    remoteRevision: revisionFromUpdatedAt(data.updatedAt),
  };
}

export type PlanningDocsFirestoreSyncArgs = {
  enabled: boolean;
  projectId: string | null;
};

/**
 * Subscribes to `projects/{projectId}/planningDocs` and mirrors remote markdown
 * into the local `planning/` folder via main-process IPC (canonical when remote
 * has documents; empty remote does not delete local-only files).
 */
export function usePlanningDocsFirestoreSync(args: PlanningDocsFirestoreSyncArgs): void {
  const { enabled, projectId } = args;
  const prevIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    prevIdsRef.current = new Set();
  }, [projectId]);

  useEffect(() => {
    if (!enabled || !projectId || !isFirebaseConfigured()) return;

    const db = getFirebaseFirestore();
    const col = collection(db, 'projects', projectId, 'planningDocs');

    const unsub = onSnapshot(
      col,
      (snap) => {
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
      },
    );

    return () => unsub();
  }, [enabled, projectId]);
}
