import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  normalizePlanningDocRelativePath,
  safeResolvePlanningMarkdownAbsPath,
} from '../planningDocs/path';
import type { PlanningDocsConflictRecordV1 } from '../planningDocs/syncTypes';
import {
  listPlanningDiskSyncDirsAbs,
  planningDiskSyncDirAbsForWrite,
} from '../planningDocs/fluxxPlanningPaths';
import { readPlanningDocsSyncState, writePlanningDocsSyncState } from './planningDocsFirestoreHydrate';

function sha256Utf8(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

const CONFLICTS_SUBDIR = 'conflicts';

async function conflictsDirsForRead(planningDir: string): Promise<string[]> {
  const syncDirs = await listPlanningDiskSyncDirsAbs(planningDir);
  if (syncDirs.length === 0) {
    return [path.join(planningDiskSyncDirAbsForWrite(planningDir), CONFLICTS_SUBDIR)];
  }
  return syncDirs.map((d) => path.join(d, CONFLICTS_SUBDIR));
}

async function readConflictRecord(
  planningDir: string,
  basename: string,
): Promise<PlanningDocsConflictRecordV1 | null> {
  for (const dir of await conflictsDirsForRead(planningDir)) {
    const abs = path.join(dir, basename);
    try {
      const raw = await fs.readFile(abs, 'utf8');
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
      /* try next dir */
    }
  }
  return null;
}

/** Newest matching artifact first. */
export async function listConflictBasenamesForPath(
  planningDir: string,
  normPath: string,
): Promise<string[]> {
  const matches: { basename: string; createdAt: string }[] = [];
  const seen = new Set<string>();
  for (const dir of await conflictsDirsForRead(planningDir)) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const basename of names) {
      if (seen.has(basename)) continue;
      seen.add(basename);
      if (!basename.endsWith('.json')) continue;
      const rec = await readConflictRecord(planningDir, basename);
      if (rec && normalizePlanningDocRelativePath(rec.relativePath) === normPath) {
        matches.push({ basename, createdAt: rec.createdAt });
      }
    }
  }
  matches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return matches.map((m) => m.basename);
}

async function unlinkConflictArtifact(planningDir: string, basename: string): Promise<void> {
  for (const dir of await conflictsDirsForRead(planningDir)) {
    try {
      await fs.unlink(path.join(dir, basename));
    } catch {
      /* ignore */
    }
  }
}

async function clearPausedForPath(planningDir: string, normPath: string): Promise<void> {
  let state = await readPlanningDocsSyncState(planningDir);
  const nextPaused = state.pausedPushPaths ? { ...state.pausedPushPaths } : undefined;
  if (nextPaused && normPath in nextPaused) {
    delete nextPaused[normPath];
  }
  state = {
    ...state,
    pausedPushPaths: nextPaused && Object.keys(nextPaused).length > 0 ? nextPaused : undefined,
  };
  await writePlanningDocsSyncState(planningDir, state);
}

export type PlanningDocsResolveConflictResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_PATH' | 'NO_RECORD' | 'WRITE_FAILED' };

/**
 * Overwrites the working markdown with the remote version from the conflict record,
 * updates disk sync state to match the remote revision, clears the push pause, and
 * removes the named conflict artifact (or the newest for the path when omitted).
 */
export async function resolvePlanningDocConflictTakeRemote(
  planningDir: string,
  relativePath: string,
  conflictBasename?: string,
): Promise<PlanningDocsResolveConflictResult> {
  const norm = normalizePlanningDocRelativePath(relativePath);
  if (!norm) return { ok: false, code: 'INVALID_PATH' };
  const allForPath = await listConflictBasenamesForPath(planningDir, norm);
  const pick =
    conflictBasename && allForPath.includes(conflictBasename)
      ? conflictBasename
      : allForPath[0];
  if (!pick) return { ok: false, code: 'NO_RECORD' };
  const rec = await readConflictRecord(planningDir, pick);
  if (!rec || normalizePlanningDocRelativePath(rec.relativePath) !== norm) {
    return { ok: false, code: 'NO_RECORD' };
  }
  const abs = safeResolvePlanningMarkdownAbsPath(planningDir, norm);
  if (!abs) return { ok: false, code: 'INVALID_PATH' };
  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, rec.remoteMarkdown, 'utf8');
  } catch {
    return { ok: false, code: 'WRITE_FAILED' };
  }
  const incomingHash = sha256Utf8(rec.remoteMarkdown);
  const touchedAt = new Date().toISOString();
  let state = await readPlanningDocsSyncState(planningDir);
  const nextPaused = state.pausedPushPaths ? { ...state.pausedPushPaths } : undefined;
  if (nextPaused && norm in nextPaused) {
    delete nextPaused[norm];
  }
  state = {
    ...state,
    files: {
      ...state.files,
      [norm]: {
        remoteRevision: rec.remoteRevision,
        lastSyncedContentHash: incomingHash,
        lastSyncedAt: touchedAt,
      },
    },
    pausedPushPaths: nextPaused && Object.keys(nextPaused).length > 0 ? nextPaused : undefined,
  };
  await writePlanningDocsSyncState(planningDir, state);
  for (const b of allForPath) {
    await unlinkConflictArtifact(planningDir, b);
  }
  return { ok: true };
}

/** Clears the push pause so upload can retry (may conflict again if remote still diverged). */
export async function resolvePlanningDocConflictResumePush(
  planningDir: string,
  relativePath: string,
): Promise<PlanningDocsResolveConflictResult> {
  const norm = normalizePlanningDocRelativePath(relativePath);
  if (!norm) return { ok: false, code: 'INVALID_PATH' };
  await clearPausedForPath(planningDir, norm);
  return { ok: true };
}

/**
 * After the user merged content into the markdown file manually: clear pause and drop
 * the conflict artifact so uploads resume against the current remote revision.
 */
export async function resolvePlanningDocConflictMarkMerged(
  planningDir: string,
  relativePath: string,
  conflictBasename?: string,
): Promise<PlanningDocsResolveConflictResult> {
  const norm = normalizePlanningDocRelativePath(relativePath);
  if (!norm) return { ok: false, code: 'INVALID_PATH' };
  await clearPausedForPath(planningDir, norm);
  const basenames = conflictBasename
    ? [conflictBasename]
    : await listConflictBasenamesForPath(planningDir, norm);
  for (const b of basenames) {
    await unlinkConflictArtifact(planningDir, b);
  }
  return { ok: true };
}

export function planningDocsSyncFolderAbs(planningDir: string): string {
  return planningDiskSyncDirAbsForWrite(planningDir);
}
