/**
 * IPC payloads for Firestore → disk planning docs hydration (cloud projects).
 */

export type PlanningDocsFirestoreDocPayload = {
  docId: string;
  relativePath: string;
  markdown: string;
  /** Serialized from Firestore `updatedAt` for revision tracking. */
  remoteRevision: string;
};

export type PlanningDocsApplyFirestoreSnapshotPayload = {
  projectId: string;
  docs: PlanningDocsFirestoreDocPayload[];
  /** Doc ids present in the previous snapshot but missing now (remote deletes). */
  removedDocIds: string[];
};

export type PlanningDocsApplyFirestoreSnapshotResult =
  | { ok: true }
  | { ok: false; code: 'PROJECT_MISMATCH' | 'NO_PROJECT' | 'INVALID_PAYLOAD' };
