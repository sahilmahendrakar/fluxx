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

/** Local disk → Firestore push candidate (main enumerates; renderer uploads). */
export type PlanningDocsPushCandidate = {
  relativePath: string;
  markdown: string;
  /** SHA-256 hex of UTF-8 markdown (matches disk sync state). */
  contentSha256: string;
  /** Present after we have synced remote metadata at least once for this path. */
  expectedRemoteRevision: string | null;
};

export type PlanningDocsListPushCandidatesResult =
  | { ok: true; candidates: PlanningDocsPushCandidate[] }
  | { ok: false; code: 'NOT_ACTIVE_CLOUD' | 'NO_PLANNING_DIR' };

export type PlanningDocsConflictRecordV1 = {
  schemaVersion: 1;
  relativePath: string;
  /** ISO timestamp when the conflict was detected. */
  createdAt: string;
  /** Revision we based the edit on (`null` when treating remote as absent). */
  baseRemoteRevision: string | null;
  localMarkdown: string;
  remoteMarkdown: string;
  remoteRevision: string;
  remoteUpdatedBy: string;
  localUpdatedBy: string;
};

export type PlanningDocsPersistConflictResult =
  | { ok: true; conflictFileBasename: string }
  | { ok: false; code: 'NOT_ACTIVE_CLOUD' | 'NO_PLANNING_DIR' | 'INVALID_RECORD' };

export type PlanningDocsRecordPushSuccessPayload = {
  projectId: string;
  relativePath: string;
  contentSha256: string;
  newRemoteRevision: string;
};

export type PlanningDocsRecordPushSuccessResult =
  | { ok: true }
  | { ok: false; code: 'NOT_ACTIVE_CLOUD' | 'NO_PLANNING_DIR' | 'INVALID_PATH' };

export type PlanningDocsPersistConflictPayload = {
  projectId: string;
  record: PlanningDocsConflictRecordV1;
};

export type PlanningDocsResolveConflictAction = 'take_remote' | 'resume_push' | 'mark_merged';

export type PlanningDocsResolveConflictPayload = {
  projectId: string;
  relativePath: string;
  action: PlanningDocsResolveConflictAction;
  conflictArtifactBasename?: string;
};

export type PlanningDocsResolveConflictIpcResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'NOT_ACTIVE_CLOUD'
        | 'NO_PLANNING_DIR'
        | 'INVALID_PATH'
        | 'NO_RECORD'
        | 'WRITE_FAILED'
        | 'INVALID_PAYLOAD';
    };

export type PlanningDocsRevealSyncFolderResult =
  | { ok: true }
  | { ok: false; code: 'NOT_ACTIVE_CLOUD' | 'NO_PLANNING_DIR' | 'OPEN_FAILED'; message?: string };
