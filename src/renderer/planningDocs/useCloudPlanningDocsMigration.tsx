import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CloudProject } from '../../types';
import {
  buildFirestoreFirstHydrationPlan,
  isUnderPlanningUnsyncedPrefix,
} from '../../planningDocs/cloudPlanningDocsMigration';
import { isFirebaseConfigured } from '../firebase';
import { CloudPlanningDocsSeedModal } from '../../components/CloudPlanningDocsSeedModal';
import { fetchFirestorePlanningDocsMarkdown, upsertFirestorePlanningDocs } from './firestorePlanningDocs';

async function loadLocalPlanningMarkdownSnapshot(): Promise<Map<string, string>> {
  const list = await window.electronAPI.planningDocs.list();
  if ('error' in list) return new Map();
  const map = new Map<string, string>();
  for (const f of list.files) {
    if (isUnderPlanningUnsyncedPrefix(f.relativePath)) continue;
    const r = await window.electronAPI.planningDocs.read(f.relativePath);
    if ('content' in r) map.set(f.relativePath, r.content);
  }
  return map;
}

/**
 * First-run cloud planning-docs migration: Firestore-first hydrate with conflict backups,
 * or explicit opt-in seed when cloud is empty. See `cloudPlanningDocsMigration.ts`.
 */
export function useCloudPlanningDocsMigration(
  project: CloudProject | null,
  uid: string | null,
): { cloudPlanningDocsSeedModal: ReactNode } {
  const [seedModal, setSeedModal] = useState<{
    projectId: string;
    projectName: string;
    localDocCount: number;
    localEntries: { relativePath: string; markdown: string }[];
  } | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const seedQueuedForProjectRef = useRef<string | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    if (!project || !uid || !isFirebaseConfigured()) return;

    const ac = new AbortController();
    const cloudProjectId = project.id;

    void (async () => {
      try {
        const remote = await fetchFirestorePlanningDocsMarkdown(cloudProjectId);
        if (ac.signal.aborted) return;

        const stateResult = await window.electronAPI.planningDocs.cloudMigration.getState(cloudProjectId);
        if (ac.signal.aborted) return;
        if ('error' in stateResult) return;
        const persisted = stateResult.state;

        if (remote.size > 0) {
          if (persisted?.didInitialHydrateFromCloud) return;
          const local = await loadLocalPlanningMarkdownSnapshot();
          if (ac.signal.aborted) return;
          const plan = buildFirestoreFirstHydrationPlan({
            remoteByPath: remote,
            localByPath: local,
          });
          const applied = await window.electronAPI.planningDocs.cloudMigration.applyHydration({
            cloudProjectId,
            plan,
          });
          if (ac.signal.aborted) return;
          if ('error' in applied) {
            console.error('[cloudPlanningDocsMigration] hydrate failed', applied.error);
            return;
          }
          await window.electronAPI.planningDocs.cloudMigration.patchState(cloudProjectId, {
            didInitialHydrateFromCloud: true,
          });
          return;
        }

        const local = await loadLocalPlanningMarkdownSnapshot();
        if (ac.signal.aborted) return;
        const entries = [...local.entries()].map(([relativePath, markdown]) => ({
          relativePath,
          markdown,
        }));

        if (entries.length === 0) return;
        if (persisted?.seedOfferResolved) return;
        if (seedQueuedForProjectRef.current === cloudProjectId) return;
        seedQueuedForProjectRef.current = cloudProjectId;
        const p = projectRef.current;
        if (!p || p.id !== cloudProjectId) return;
        setSeedModal({
          projectId: cloudProjectId,
          projectName: p.name,
          localDocCount: entries.length,
          localEntries: entries,
        });
      } catch (err) {
        if (ac.signal.aborted) return;
        console.error('[cloudPlanningDocsMigration]', err);
      }
    })();

    return () => {
      ac.abort();
    };
  }, [project?.id, uid]);

  const modal =
    seedModal && project?.id === seedModal.projectId ? (
      <CloudPlanningDocsSeedModal
        projectName={seedModal.projectName}
        localDocCount={seedModal.localDocCount}
        busy={seedBusy}
        onSkip={async () => {
          if (seedBusy) return;
          const pid = seedModal.projectId;
          setSeedBusy(true);
          try {
            await window.electronAPI.planningDocs.cloudMigration.patchState(pid, {
              seedOfferResolved: 'skipped',
            });
          } finally {
            setSeedBusy(false);
            setSeedModal(null);
          }
        }}
        onUploadToCloud={async () => {
          const currentUid = uid;
          if (!currentUid || seedBusy) return;
          const pid = seedModal.projectId;
          setSeedBusy(true);
          try {
            await upsertFirestorePlanningDocs(pid, currentUid, seedModal.localEntries);
            await window.electronAPI.planningDocs.cloudMigration.patchState(pid, {
              seedOfferResolved: 'uploaded',
              didInitialHydrateFromCloud: true,
            });
          } catch (err) {
            console.error('[cloudPlanningDocsMigration] seed upload failed', err);
          } finally {
            setSeedBusy(false);
            setSeedModal(null);
          }
        }}
      />
    ) : null;

  return { cloudPlanningDocsSeedModal: modal };
}
