import fs from 'node:fs/promises';
import {
  MAX_PLANNING_RELATIVE_PATH_UTF8_BYTES,
  normalizePlanningDocRelativePath,
  isPlanningMarkdownRelativePathForbiddenForUserWrite,
  safeResolvePlanningMarkdownAbsPath,
} from './planningDocs/path';
import type { TaskAttachedPlanningDoc } from './types';

/** Matches Firestore rules cap on `tasks.attachedPlanningDocs` list length. */
export const MAX_TASK_ATTACHED_PLANNING_DOCS = 32;

/**
 * Normalizes, dedupes, caps, and drops invalid planning-doc paths for task storage.
 * Invalid entries are skipped (never throws). Forbidden sync paths are excluded.
 */
export function sanitizeTaskAttachedPlanningDocsInput(raw: unknown): TaskAttachedPlanningDoc[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: TaskAttachedPlanningDoc[] = [];
  for (const item of raw) {
    if (out.length >= MAX_TASK_ATTACHED_PLANNING_DOCS) {
      break;
    }
    const rel =
      item &&
      typeof item === 'object' &&
      typeof (item as { relativePath?: unknown }).relativePath === 'string'
        ? (item as { relativePath: string }).relativePath
        : null;
    if (rel == null) {
      continue;
    }
    const norm = normalizePlanningDocRelativePath(rel);
    if (!norm || isPlanningMarkdownRelativePathForbiddenForUserWrite(norm)) {
      continue;
    }
    if (new TextEncoder().encode(norm).length > MAX_PLANNING_RELATIVE_PATH_UTF8_BYTES) {
      continue;
    }
    if (seen.has(norm)) {
      continue;
    }
    seen.add(norm);
    out.push({ relativePath: norm });
  }
  return out;
}

/** Firestore / disk read: omit field when nothing valid remains. */
export function parsePersistedTaskAttachedPlanningDocs(
  val: unknown,
): TaskAttachedPlanningDoc[] | undefined {
  const s = sanitizeTaskAttachedPlanningDocsInput(val);
  return s.length > 0 ? s : undefined;
}

export type ParsedTaskAttachedPlanningDocsForMcp =
  | { ok: true; docs: TaskAttachedPlanningDoc[] | null | undefined }
  | { ok: false; message: string };

/**
 * Strict parse for Flux MCP: rejects invalid paths (UI/store sanitization only drops them).
 * `undefined` — field omitted. `null` — only valid on update (clear attachments). `[]` — no attachments.
 */
export function parseTaskAttachedPlanningDocsForMcp(
  raw: unknown,
  mode: 'create' | 'update',
): ParsedTaskAttachedPlanningDocsForMcp {
  if (raw === undefined) {
    return { ok: true, docs: undefined };
  }
  if (raw === null) {
    if (mode === 'create') {
      return {
        ok: false,
        message:
          'attachedPlanningDocs cannot be null on create; omit the field, or pass [] for no attachments.',
      };
    }
    return { ok: true, docs: null };
  }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      message: 'attachedPlanningDocs must be an array of { relativePath: string } objects.',
    };
  }
  if (raw.length > MAX_TASK_ATTACHED_PLANNING_DOCS) {
    return {
      ok: false,
      message: `attachedPlanningDocs supports at most ${MAX_TASK_ATTACHED_PLANNING_DOCS} entries.`,
    };
  }
  const seen = new Set<string>();
  const out: TaskAttachedPlanningDoc[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as { relativePath?: unknown }).relativePath !== 'string'
    ) {
      return {
        ok: false,
        message: `attachedPlanningDocs[${i}] must be an object with a string relativePath (a .md path under the project planning/ folder, forward slashes).`,
      };
    }
    const rel = (item as { relativePath: string }).relativePath;
    const norm = normalizePlanningDocRelativePath(rel);
    if (!norm) {
      return {
        ok: false,
        message: `Invalid planning doc path in attachedPlanningDocs[${i}]: "${rel}". Use paths like "notes/plan.md" (.md only, no ".." segments).`,
      };
    }
    if (isPlanningMarkdownRelativePathForbiddenForUserWrite(norm)) {
      return {
        ok: false,
        message: `Forbidden planning doc path in attachedPlanningDocs[${i}]: "${norm}" (sync-internal paths cannot be attached).`,
      };
    }
    if (new TextEncoder().encode(norm).length > MAX_PLANNING_RELATIVE_PATH_UTF8_BYTES) {
      return {
        ok: false,
        message: `Planning doc path too long in attachedPlanningDocs[${i}].`,
      };
    }
    if (seen.has(norm)) {
      continue;
    }
    seen.add(norm);
    out.push({ relativePath: norm });
  }
  return { ok: true, docs: out };
}

/**
 * Ensures each attachment resolves to a regular file under `planningDir` (mirrors cloud/local planning root).
 */
export async function assertAttachedPlanningMarkdownFilesExist(
  planningDir: string,
  docs: TaskAttachedPlanningDoc[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (docs.length === 0) {
    return { ok: true };
  }
  let dirOk = false;
  try {
    const st = await fs.stat(planningDir);
    dirOk = st.isDirectory();
  } catch {
    dirOk = false;
  }
  if (!dirOk) {
    return {
      ok: false,
      message: `Planning directory not found at ${planningDir}. Ensure the project workspace is open and planning/ exists before attaching planning docs.`,
    };
  }
  for (const doc of docs) {
    const abs = safeResolvePlanningMarkdownAbsPath(planningDir, doc.relativePath);
    if (!abs) {
      return { ok: false, message: `Invalid planning doc path: "${doc.relativePath}".` };
    }
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) {
        return {
          ok: false,
          message: `Planning doc "${doc.relativePath}" is not a file (expected a markdown file under planning/).`,
        };
      }
    } catch {
      return {
        ok: false,
        message: `Planning doc not found: "${doc.relativePath}". Paths are relative to the project planning/ directory; create the file or fix the spelling.`,
      };
    }
  }
  return { ok: true };
}
