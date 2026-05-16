import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isUnderPlanningUnsyncedPrefix } from '../planningDocs/cloudPlanningDocsMigration';
import {
  normalizePlanningDocRelativePath,
  planningUserDocsDir,
  isPlanningUserDocRelativePathDisallowed,
  safeResolvePlanningMarkdownAbsPath,
} from '../planningDocs/path';
import type { PlanningDocsPushCandidate } from '../planningDocs/syncTypes';
import {
  PLANNING_DOCS_DISK_SYNC_DIR,
  readPlanningDocsSyncState,
} from './planningDocsFirestoreHydrate';
import { readPlanningDocsCloudMigrationState } from './planningDocsMigrationDisk';

function sha256Utf8(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function shouldSkipPlanningRelPath(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm === PLANNING_DOCS_DISK_SYNC_DIR || norm.startsWith(`${PLANNING_DOCS_DISK_SYNC_DIR}/`)) {
    return true;
  }
  return isUnderPlanningUnsyncedPrefix(norm);
}

async function collectMarkdownRelPaths(dir: string, base: string): Promise<string[]> {
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  const sorted = [...dirents].sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of sorted) {
    const rel = base ? `${base}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    const relSlash = rel.split(path.sep).join('/');
    if (shouldSkipPlanningRelPath(relSlash)) {
      continue;
    }
    if (ent.isDirectory()) {
      out.push(...(await collectMarkdownRelPaths(full, rel)));
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
      out.push(relSlash);
    }
  }
  return out;
}

/**
 * Avoid uploading before Firestore-first hydrate / explicit seed decision
 * (see `useCloudPlanningDocsMigration`). If disk sync state already tracks remote files,
 * allow push so workspaces hydrated before migration metadata existed keep working.
 */
export async function isPlanningDocsFirestorePushUnlocked(
  planningDir: string,
  cloudProjectId: string,
): Promise<boolean> {
  const persisted = await readPlanningDocsCloudMigrationState(planningDir, cloudProjectId);
  if (persisted?.didInitialHydrateFromCloud) return true;
  if (persisted?.seedOfferResolved) return true;
  const sync = await readPlanningDocsSyncState(planningDir);
  if (Object.keys(sync.files).length > 0) return true;
  return false;
}

/**
 * Markdown files whose disk content differs from the last successfully synced hash,
 * meaning local or agent edits need uploading (when remote revision still matches base).
 */
export async function listPlanningDocsPushCandidates(
  planningDir: string,
  cloudProjectId: string,
): Promise<PlanningDocsPushCandidate[]> {
  if (!(await isPlanningDocsFirestorePushUnlocked(planningDir, cloudProjectId))) {
    return [];
  }

  const state = await readPlanningDocsSyncState(planningDir);
  const relativePaths = await collectMarkdownRelPaths(planningUserDocsDir(planningDir), '');
  const out: PlanningDocsPushCandidate[] = [];

  for (const rel of relativePaths) {
    const norm = normalizePlanningDocRelativePath(rel);
    if (!norm) continue;
    if (isPlanningUserDocRelativePathDisallowed(norm)) continue;
    const abs = safeResolvePlanningMarkdownAbsPath(planningDir, norm);
    if (!abs) continue;
    let markdown: string;
    try {
      markdown = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const diskHash = sha256Utf8(markdown);
    if (state.pausedPushPaths?.[norm]) {
      continue;
    }

    const meta = state.files[norm];
    if (meta !== undefined && meta.lastSyncedContentHash === diskHash) {
      continue;
    }
    out.push({
      relativePath: norm,
      markdown,
      contentSha256: diskHash,
      expectedRemoteRevision: meta?.remoteRevision ?? null,
    });
  }

  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}
