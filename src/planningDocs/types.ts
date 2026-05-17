/**
 * Shared planning-docs contracts for local disk, cloud workspace mirrors, and
 * Firestore-backed sync. IPC layers map these to renderer-facing payloads.
 */

/** How list/read are backed today (Firestore reads plug in under cloud later). */
export type PlanningDocsBackendKind =
  | 'local-disk'
  /** Local `.fluxx/.../planning/` mirror while sync catches up; not authoritative. */
  | 'cloud-workspace-mirror-disk';

/** Optional UI/agent metadata for a planning markdown file. */
export interface PlanningDocMetadata {
  /** UTF-8 byte length of markdown body when known (e.g. after read or sync). */
  byteLength?: number;
  /** Source revision token when syncing (Firestore snapshot version, etag, etc.). */
  revision?: string;
}

/** Sync lifecycle for a doc — populated when cloud sync is active. */
export type PlanningDocSyncStatus =
  | 'idle'
  | 'pending_pull'
  | 'pending_push'
  | 'conflict'
  /** Local disk matches last recorded cloud revision for this path. */
  | 'synced';

/** Extra cloud-sync fields for Docs UI (omitted for local-only projects). */
export interface PlanningDocSyncInfo {
  /** ISO time when this path was last aligned with cloud on disk. */
  lastSyncedAt?: string;
  /** When a push conflict pause is active for this path. */
  conflictPausedAt?: string;
  /** Newest local conflict artifact under `.fluxx-docs-sync/conflicts/` (legacy dir honored on read). */
  conflictArtifactBasename?: string;
}

export interface PlanningDocFileEntry {
  /** Project-relative path using forward slashes (e.g. `notes/architecture.md`). */
  relativePath: string;
  metadata?: PlanningDocMetadata;
  /** When omitted, treat as `idle` / local-only. */
  syncStatus?: PlanningDocSyncStatus;
  /** Cloud mirror only — disk / conflict diagnostics. */
  syncInfo?: PlanningDocSyncInfo;
}

/** Aggregate planning-docs sync info for cloud workspaces (list IPC). */
export interface PlanningDocsCloudListMeta {
  source: 'cloud-firestore-mirror';
  /** When `state.json` was last modified, if present. */
  syncStateUpdatedAt?: string;
  totalConflictPaths: number;
  totalPendingPush: number;
  totalSynced: number;
}

export type PlanningDocsListErrorCode = 'NO_PROJECT' | 'IO_ERROR';

export type PlanningDocsReadErrorCode =
  | 'NO_PROJECT'
  | 'INVALID_PATH'
  | 'NOT_FOUND'
  | 'READ_FAILED';

/** Narrow IPC/list results — extend cautiously for backward compatibility. */
export type PlanningDocsListResult =
  | { files: PlanningDocFileEntry[]; cloudListMeta?: PlanningDocsCloudListMeta }
  | { error: PlanningDocsListErrorCode };

export type PlanningDocsReadResult =
  | { content: string }
  | { error: PlanningDocsReadErrorCode };

export type PlanningDocsWriteErrorCode =
  | 'NO_PROJECT'
  | 'INVALID_PATH'
  | 'FORBIDDEN_PATH'
  | 'INVALID_CONTENT'
  | 'IO_ERROR';

export type PlanningDocsWriteResult = { ok: true } | { error: PlanningDocsWriteErrorCode };

/**
 * Firestore document shape for `projects/{projectId}/planningDocs/{docId}`.
 *
 * - `docId` is a stable encoding of `relativePath` — see `planningRelativePathToFirestoreDocId`.
 * - Team members may create/update docs; `updatedBy` must match the writer uid.
 * - Push conflicts are appended under `planningDocs/{docId}/conflicts/*` (see `appendPlanningDocFirestoreConflict`).
 */
export interface FirestorePlanningDocDocumentV1 {
  schemaVersion: 1;
  /** Canonical forward-slash path ending in `.md`, matching decoded `docId`. */
  relativePath: string;
  markdown: string;
  /** Firestore `timestamp`; typed loosely here to avoid coupling to client SDK. */
  updatedAt: { seconds: number; nanoseconds: number } | Date | unknown;
  updatedBy: string;
}

/** Per-machine state next to `planning/` — see `cloudPlanningDocsMigration.ts` header. */
export type PlanningDocsSeedOfferResolution = 'uploaded' | 'skipped';

export interface PlanningDocsCloudMigrationPersistedV1 {
  version: 1;
  cloudProjectId: string;
  /** Set after a successful Firestore-first disk hydrate for a non-empty cloud doc set. */
  didInitialHydrateFromCloud?: boolean;
  /** When cloud was empty, records the one-time seed offer outcome. */
  seedOfferResolved?: PlanningDocsSeedOfferResolution;
}
