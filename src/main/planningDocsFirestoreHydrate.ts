import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  PlanningDocsApplyFirestoreSnapshotPayload,
  PlanningDocsConflictRecordV1,
} from '../planningDocs/syncTypes';
import {
  normalizePlanningDocRelativePath,
  planningFirestoreDocIdToRelativePath,
  planningRelativePathToFirestoreDocId,
  safeResolvePlanningMarkdownAbsPath,
} from '../planningDocs/path';

import {
  FLUXX_PLANNING_DOCS_DISK_SYNC_PREFIX,
  planningDiskSyncDirAbsForWrite,
  resolvePlanningDiskSyncDirAbs,
} from '../planningDocs/fluxxPlanningPaths';

/** Dot-directory next to mirrored markdown — sync state and conflict artifacts. */
export const PLANNING_DOCS_DISK_SYNC_DIR = FLUXX_PLANNING_DOCS_DISK_SYNC_PREFIX;

const STATE_FILENAME = 'state.json';
const CONFLICTS_SUBDIR = 'conflicts';

export interface PlanningDocsDiskSyncFileEntryV1 {
  remoteRevision: string;
  lastSyncedContentHash: string;
  /** ISO 8601 when this path was last aligned with cloud (snapshot apply or push success). */
  lastSyncedAt?: string;
}

export interface PlanningDocsDiskSyncStateV1 {
  schemaVersion: 1;
  /** Keyed by normalized relativePath */
  files: Record<string, PlanningDocsDiskSyncFileEntryV1>;
  /**
   * Paths where upload hit a revision conflict — excluded from push retries until a
   * successful remote hydrate updates the file or this entry is cleared manually.
   */
  pausedPushPaths?: Record<string, { at: string }>;
}

function sha256Utf8(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function syncStatePath(planningDir: string): string {
  return path.join(planningDiskSyncDirAbsForWrite(planningDir), STATE_FILENAME);
}

async function syncStatePathForRead(planningDir: string): Promise<string | null> {
  const syncDir = await resolvePlanningDiskSyncDirAbs(planningDir);
  if (!syncDir) return null;
  return path.join(syncDir, STATE_FILENAME);
}

export async function readPlanningDocsSyncState(
  planningDir: string,
): Promise<PlanningDocsDiskSyncStateV1> {
  const p = await syncStatePathForRead(planningDir);
  if (!p) {
    return { schemaVersion: 1, files: {} };
  }
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as PlanningDocsDiskSyncStateV1).schemaVersion === 1 &&
      typeof (parsed as PlanningDocsDiskSyncStateV1).files === 'object' &&
      (parsed as PlanningDocsDiskSyncStateV1).files !== null
    ) {
      const st = parsed as PlanningDocsDiskSyncStateV1;
      return {
        ...st,
        pausedPushPaths:
          st.pausedPushPaths && typeof st.pausedPushPaths === 'object' ? st.pausedPushPaths : undefined,
      };
    }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: 1, files: {} };
    }
  }
  return { schemaVersion: 1, files: {} };
}

export async function writePlanningDocsSyncState(
  planningDir: string,
  state: PlanningDocsDiskSyncStateV1,
): Promise<void> {
  const dir = planningDiskSyncDirAbsForWrite(planningDir);
  await fs.mkdir(dir, { recursive: true });
  const p = syncStatePath(planningDir);
  await fs.writeFile(p, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function isValidPayload(
  payload: unknown,
): payload is PlanningDocsApplyFirestoreSnapshotPayload {
  if (!payload || typeof payload !== 'object') return false;
  const o = payload as PlanningDocsApplyFirestoreSnapshotPayload;
  if (typeof o.projectId !== 'string' || o.projectId.length === 0) return false;
  if (!Array.isArray(o.docs) || !Array.isArray(o.removedDocIds)) return false;
  for (const d of o.docs) {
    if (!d || typeof d !== 'object') return false;
    const row = d as PlanningDocsApplyFirestoreSnapshotPayload['docs'][number];
    if (typeof row.docId !== 'string' || typeof row.relativePath !== 'string') return false;
    if (typeof row.markdown !== 'string' || typeof row.remoteRevision !== 'string') return false;
  }
  for (const id of o.removedDocIds) {
    if (typeof id !== 'string') return false;
  }
  return true;
}

/** @returns whether any file was written or deleted */
export async function applyFirestorePlanningDocsSnapshot(
  planningDir: string,
  payload: unknown,
): Promise<{ ok: true; changed: boolean } | { ok: false; code: 'INVALID_PAYLOAD' }> {
  if (!isValidPayload(payload)) {
    return { ok: false, code: 'INVALID_PAYLOAD' };
  }

  let state = await readPlanningDocsSyncState(planningDir);
  let changed = false;

  for (const doc of payload.docs) {
    const normPath = normalizePlanningDocRelativePath(doc.relativePath);
    if (!normPath) continue;
    const expectedId = planningRelativePathToFirestoreDocId(normPath);
    if (!expectedId || expectedId !== doc.docId) continue;

    const abs = safeResolvePlanningMarkdownAbsPath(planningDir, normPath);
    if (!abs) continue;

    const incomingHash = sha256Utf8(doc.markdown);
    const prevMeta = state.files[normPath];

    let diskHash: string | null = null;
    try {
      const diskContent = await fs.readFile(abs, 'utf8');
      diskHash = sha256Utf8(diskContent);
    } catch {
      diskHash = null;
    }

    const shouldApply =
      prevMeta === undefined ||
      prevMeta.lastSyncedContentHash === diskHash ||
      diskHash === null;

    if (!shouldApply) {
      continue;
    }

    if (
      diskHash !== null &&
      diskHash === incomingHash &&
      prevMeta?.remoteRevision === doc.remoteRevision
    ) {
      continue;
    }

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, doc.markdown, 'utf8');
    changed = true;

    const nextPaused = state.pausedPushPaths ? { ...state.pausedPushPaths } : undefined;
    if (nextPaused && normPath in nextPaused) {
      delete nextPaused[normPath];
    }

    const touchedAt = new Date().toISOString();
    state = {
      ...state,
      files: {
        ...state.files,
        [normPath]: {
          remoteRevision: doc.remoteRevision,
          lastSyncedContentHash: incomingHash,
          lastSyncedAt: touchedAt,
        },
      },
      pausedPushPaths: nextPaused && Object.keys(nextPaused).length > 0 ? nextPaused : undefined,
    };
  }

  for (const docId of payload.removedDocIds) {
    const normPath = planningFirestoreDocIdToRelativePath(docId);
    if (!normPath) continue;
    const abs = safeResolvePlanningMarkdownAbsPath(planningDir, normPath);
    if (!abs) continue;

    const prevMeta = state.files[normPath];
    if (!prevMeta) {
      continue;
    }

    let diskHash: string | null = null;
    try {
      diskHash = sha256Utf8(await fs.readFile(abs, 'utf8'));
    } catch {
      diskHash = null;
    }

    if (diskHash !== prevMeta.lastSyncedContentHash) {
      continue;
    }

    try {
      await fs.unlink(abs);
      changed = true;
    } catch {
      /* ignore */
    }

    const nextFiles = { ...state.files };
    delete nextFiles[normPath];
    const nextPaused = state.pausedPushPaths ? { ...state.pausedPushPaths } : undefined;
    if (nextPaused && normPath in nextPaused) {
      delete nextPaused[normPath];
    }
    state = {
      ...state,
      files: nextFiles,
      pausedPushPaths: nextPaused && Object.keys(nextPaused).length > 0 ? nextPaused : undefined,
    };
  }

  if (changed) {
    await writePlanningDocsSyncState(planningDir, state);
  }

  return { ok: true, changed };
}

export async function recordPlanningDocsPushSuccess(
  planningDir: string,
  normPath: string,
  contentHash: string,
  newRemoteRevision: string,
): Promise<void> {
  let state = await readPlanningDocsSyncState(planningDir);
  const nextPaused = state.pausedPushPaths ? { ...state.pausedPushPaths } : undefined;
  if (nextPaused && normPath in nextPaused) {
    delete nextPaused[normPath];
  }
  const touchedAt = new Date().toISOString();
  state = {
    ...state,
    files: {
      ...state.files,
      [normPath]: {
        remoteRevision: newRemoteRevision,
        lastSyncedContentHash: contentHash,
        lastSyncedAt: touchedAt,
      },
    },
    pausedPushPaths: nextPaused && Object.keys(nextPaused).length > 0 ? nextPaused : undefined,
  };
  await writePlanningDocsSyncState(planningDir, state);
}

export async function persistPlanningDocsConflictLocal(
  planningDir: string,
  record: PlanningDocsConflictRecordV1,
): Promise<string> {
  const dir = path.join(planningDiskSyncDirAbsForWrite(planningDir), CONFLICTS_SUBDIR);
  await fs.mkdir(dir, { recursive: true });
  const safePath = Buffer.from(record.relativePath, 'utf8').toString('base64url').slice(0, 200);
  const basename = `${record.createdAt.replace(/[:.]/g, '-')}_${safePath}.json`;
  const abs = path.join(dir, basename);
  await fs.writeFile(abs, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  let state = await readPlanningDocsSyncState(planningDir);
  state = {
    ...state,
    pausedPushPaths: {
      ...(state.pausedPushPaths ?? {}),
      [record.relativePath]: { at: record.createdAt },
    },
  };
  await writePlanningDocsSyncState(planningDir, state);

  return basename;
}
