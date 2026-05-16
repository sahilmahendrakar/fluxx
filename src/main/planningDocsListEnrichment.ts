import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  normalizePlanningDocRelativePath,
  resolvePlanningUserMarkdownAbsPathForRead,
} from '../planningDocs/path';
import type {
  PlanningDocFileEntry,
  PlanningDocsCloudListMeta,
  PlanningDocsListResult,
} from '../planningDocs/types';
import type { PlanningDocsConflictRecordV1 } from '../planningDocs/syncTypes';
import { listPlanningDocsPushCandidates } from './planningDocsFirestorePush';
import {
  PLANNING_DOCS_DISK_SYNC_DIR,
  readPlanningDocsSyncState,
  syncStatePath,
} from './planningDocsFirestoreHydrate';
function sha256Utf8(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function readConflictRecord(
  planningDir: string,
  conflictsDirPath: string,
  basename: string,
): Promise<PlanningDocsConflictRecordV1 | null> {
  try {
    const raw = await fs.readFile(path.join(conflictsDirPath, basename), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as PlanningDocsConflictRecordV1).schemaVersion === 1 &&
      typeof (parsed as PlanningDocsConflictRecordV1).relativePath === 'string'
    ) {
      return parsed as PlanningDocsConflictRecordV1;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Map norm path -> latest conflict artifact basename for that path. */
async function latestConflictBasenameByPath(
  planningDir: string,
): Promise<Map<string, { basename: string; createdAt: string }>> {
  const dir = path.join(planningDir, PLANNING_DOCS_DISK_SYNC_DIR, 'conflicts');
  const out = new Map<string, { basename: string; createdAt: string }>();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const basename of names) {
    if (!basename.endsWith('.json')) continue;
    const rec = await readConflictRecord(planningDir, dir, basename);
    if (!rec) continue;
    const norm = normalizePlanningDocRelativePath(rec.relativePath);
    if (!norm) continue;
    const prev = out.get(norm);
    if (!prev || rec.createdAt > prev.createdAt) {
      out.set(norm, { basename, createdAt: rec.createdAt });
    }
  }
  return out;
}

/**
 * Adds per-file sync fields and aggregate metadata for cloud workspace mirrors.
 * No-op when `listResult` is an error.
 */
export async function enrichPlanningDocsListForCloudWorkspace(
  planningDir: string,
  cloudProjectId: string,
  listResult: PlanningDocsListResult,
): Promise<PlanningDocsListResult> {
  if ('error' in listResult) {
    return listResult;
  }

  const syncState = await readPlanningDocsSyncState(planningDir);
  const pushCandidates = await listPlanningDocsPushCandidates(planningDir, cloudProjectId);
  const pendingPushSet = new Set(pushCandidates.map((c) => c.relativePath));
  const conflictBasenames = await latestConflictBasenameByPath(planningDir);

  let syncStateUpdatedAt: string | undefined;
  try {
    const st = await fs.stat(syncStatePath(planningDir));
    syncStateUpdatedAt = st.mtime.toISOString();
  } catch {
    syncStateUpdatedAt = undefined;
  }

  let totalConflictPaths = 0;
  let totalPendingPush = 0;
  let totalSynced = 0;

  const files: PlanningDocFileEntry[] = [];
  for (const entry of listResult.files) {
    const norm = normalizePlanningDocRelativePath(entry.relativePath);
    if (!norm) {
      files.push(entry);
      continue;
    }

    const abs = await resolvePlanningUserMarkdownAbsPathForRead(planningDir, norm, (p) => fs.access(p));
    let diskHash: string | null = null;
    if (abs) {
      try {
        diskHash = sha256Utf8(await fs.readFile(abs, 'utf8'));
      } catch {
        diskHash = null;
      }
    }

    const meta = syncState.files[norm];
    const paused = syncState.pausedPushPaths?.[norm];
    const conflictArt = conflictBasenames.get(norm);

    let syncStatus = entry.syncStatus;
    const syncInfo: PlanningDocFileEntry['syncInfo'] = {
      lastSyncedAt: meta?.lastSyncedAt,
      conflictPausedAt: paused?.at,
      conflictArtifactBasename: conflictArt?.basename,
    };

    const metadata = {
      ...entry.metadata,
      revision: meta?.remoteRevision ?? entry.metadata?.revision,
    };

    if (paused) {
      syncStatus = 'conflict';
      totalConflictPaths += 1;
    } else if (pendingPushSet.has(norm)) {
      syncStatus = 'pending_push';
      totalPendingPush += 1;
    } else if (meta && diskHash !== null && meta.lastSyncedContentHash === diskHash) {
      syncStatus = 'synced';
      totalSynced += 1;
    } else if (!meta) {
      syncStatus = 'idle';
    } else {
      syncStatus = 'pending_push';
      totalPendingPush += 1;
    }

    files.push({
      ...entry,
      metadata,
      syncStatus,
      syncInfo,
    });
  }

  const cloudListMeta: PlanningDocsCloudListMeta = {
    source: 'cloud-firestore-mirror',
    syncStateUpdatedAt,
    totalConflictPaths,
    totalPendingPush,
    totalSynced,
  };

  return { files, cloudListMeta };
}
