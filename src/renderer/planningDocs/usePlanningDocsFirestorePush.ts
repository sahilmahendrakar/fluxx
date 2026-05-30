import { useEffect, useRef } from 'react';
import { planningRelativePathToFirestoreDocId } from '../../planningDocs/path';
import type { PlanningDocsConflictRecordV1 } from '../../planningDocs/syncTypes';
import {
  appendPlanningDocFirestoreConflict,
  deletePlanningDocFromFirestore,
  pushPlanningDocToFirestore,
} from './firestorePlanningDocs';
import { isFirebaseConfigured } from '../firebase';

const DEBOUNCE_MS = 650;

export type PlanningDocsFirestorePushArgs = {
  enabled: boolean;
  projectId: string | null;
  uid: string | null;
};

/**
 * Uploads dirty planning markdown for cloud workspaces using optimistic revision checks.
 * Hydration-triggered FS writes are ignored via main-process watcher suppression; conflicts
 * persist locally and under `planningDocs/{docId}/conflicts` in Firestore.
 */
export function usePlanningDocsFirestorePush(args: PlanningDocsFirestorePushArgs): void {
  const { enabled, projectId, uid } = args;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);

  useEffect(() => {
    if (!enabled || !projectId || !uid || !isFirebaseConfigured()) return;

    const runPush = async (): Promise<void> => {
      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        const deleteListed = await window.electronAPI.planningDocs.listDeleteCandidates(projectId);
        if (deleteListed.ok) {
          for (const c of deleteListed.candidates) {
            const del = await deletePlanningDocFromFirestore(projectId, c.relativePath, {
              remoteRevision: c.expectedRemoteRevision,
            });

            if (del.ok) {
              const rec = await window.electronAPI.planningDocs.recordDeleteSuccess({
                projectId,
                relativePath: c.relativePath,
              });
              if (!rec.ok) {
                console.warn('[usePlanningDocsFirestorePush] recordDeleteSuccess failed', rec);
              }
              continue;
            }

            if (del.reason === 'remote_missing') {
              const rec = await window.electronAPI.planningDocs.recordDeleteSuccess({
                projectId,
                relativePath: c.relativePath,
              });
              if (!rec.ok) {
                console.warn('[usePlanningDocsFirestorePush] recordDeleteSuccess failed', rec);
              }
              continue;
            }

            const record: PlanningDocsConflictRecordV1 = {
              schemaVersion: 1,
              relativePath: c.relativePath,
              createdAt: new Date().toISOString(),
              baseRemoteRevision: c.expectedRemoteRevision,
              localMarkdown: '',
              remoteMarkdown: del.remoteMarkdown,
              remoteRevision: del.remoteRevision,
              remoteUpdatedBy: del.remoteUpdatedBy,
              localUpdatedBy: uid,
            };
            const persisted = await window.electronAPI.planningDocs.persistConflict({
              projectId,
              record,
            });
            if (!persisted.ok) {
              console.warn('[usePlanningDocsFirestorePush] persistConflict failed', persisted);
              continue;
            }
            const docId = planningRelativePathToFirestoreDocId(c.relativePath);
            if (docId) {
              await appendPlanningDocFirestoreConflict(projectId, docId, record).catch((err) =>
                console.warn('[usePlanningDocsFirestorePush] Firestore conflict append failed', err),
              );
            }
          }
        }

        const listed = await window.electronAPI.planningDocs.listPushCandidates(projectId);
        if (!listed.ok) return;

        for (const c of listed.candidates) {
          const expectation =
            c.expectedRemoteRevision === null
              ? ({ kind: 'absent' as const })
              : ({ kind: 'revision' as const, remoteRevision: c.expectedRemoteRevision });

          const push = await pushPlanningDocToFirestore(
            projectId,
            uid,
            c.relativePath,
            c.markdown,
            expectation,
          );

          if (push.ok) {
            const rec = await window.electronAPI.planningDocs.recordPushSuccess({
              projectId,
              relativePath: c.relativePath,
              contentSha256: c.contentSha256,
              newRemoteRevision: push.newRemoteRevision,
            });
            if (!rec.ok) {
              console.warn('[usePlanningDocsFirestorePush] recordPushSuccess failed', rec);
            }
            continue;
          }

          if (push.reason === 'remote_changed') {
            const record: PlanningDocsConflictRecordV1 = {
              schemaVersion: 1,
              relativePath: c.relativePath,
              createdAt: new Date().toISOString(),
              baseRemoteRevision: c.expectedRemoteRevision,
              localMarkdown: c.markdown,
              remoteMarkdown: push.remoteMarkdown,
              remoteRevision: push.remoteRevision,
              remoteUpdatedBy: push.remoteUpdatedBy,
              localUpdatedBy: uid,
            };
            const persisted = await window.electronAPI.planningDocs.persistConflict({
              projectId,
              record,
            });
            if (!persisted.ok) {
              console.warn('[usePlanningDocsFirestorePush] persistConflict failed', persisted);
              continue;
            }
            const docId = planningRelativePathToFirestoreDocId(c.relativePath);
            if (docId) {
              await appendPlanningDocFirestoreConflict(projectId, docId, record).catch((err) =>
                console.warn('[usePlanningDocsFirestorePush] Firestore conflict append failed', err),
              );
            }
            continue;
          }

          const record: PlanningDocsConflictRecordV1 = {
            schemaVersion: 1,
            relativePath: c.relativePath,
            createdAt: new Date().toISOString(),
            baseRemoteRevision: c.expectedRemoteRevision,
            localMarkdown: c.markdown,
            remoteMarkdown: '',
            remoteRevision: '(deleted)',
            remoteUpdatedBy: '',
            localUpdatedBy: uid,
          };
          const persisted = await window.electronAPI.planningDocs.persistConflict({
            projectId,
            record,
          });
          if (!persisted.ok) {
            console.warn('[usePlanningDocsFirestorePush] persistConflict failed', persisted);
            continue;
          }
          const docId = planningRelativePathToFirestoreDocId(c.relativePath);
          if (docId) {
            await appendPlanningDocFirestoreConflict(projectId, docId, record).catch((err) =>
              console.warn('[usePlanningDocsFirestorePush] Firestore conflict append failed', err),
            );
          }
        }
      } catch (err) {
        console.error('[usePlanningDocsFirestorePush] push cycle failed', err);
      } finally {
        inflightRef.current = false;
      }
    };

    const schedule = (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void runPush();
      }, DEBOUNCE_MS);
    };

    schedule();
    const unsub = window.electronAPI.planningDocs.onChanged(schedule);
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, projectId, uid]);
}
