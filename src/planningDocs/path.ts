import path from 'node:path';
import { Buffer } from 'node:buffer';

const MD_SUFFIX = '.md';

/** Stay under Firestore's 1500-byte document id limit after base64url expansion. */
export const MAX_PLANNING_RELATIVE_PATH_UTF8_BYTES = 1024;

function isValidPlanningSegment(seg: string): boolean {
  if (seg.length === 0) return false;
  if (seg === '.' || seg === '..') return false;
  if (seg.includes('/') || seg.includes('\\')) return false;
  return true;
}

/**
 * Validates and normalizes a repo-relative planning markdown path for storage
 * and Firestore encoding (forward slashes, no traversal).
 */
export function normalizePlanningDocRelativePath(input: string): string | null {
  if (typeof input !== 'string' || input.includes('\0')) return null;
  const slash = input.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (slash.length === 0) return null;
  const segments = slash.split('/');
  if (segments.length === 0) return null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!isValidPlanningSegment(seg)) return null;
  }
  const last = segments[segments.length - 1];
  if (!last.toLowerCase().endsWith(MD_SUFFIX)) return null;
  return segments.join('/');
}

/**
 * Resolve `relativePath` under `planningDir` with traversal protection.
 * Returns absolute filesystem path or null when invalid.
 */
export function safeResolvePlanningMarkdownAbsPath(
  planningDir: string,
  relativePath: string,
): string | null {
  const norm = normalizePlanningDocRelativePath(relativePath);
  if (!norm) return null;
  const candidate = path.resolve(planningDir, norm);
  const resolvedRoot = path.resolve(planningDir);
  if (candidate === resolvedRoot) return null;
  const relCheck = path.relative(resolvedRoot, candidate);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return null;
  return candidate;
}

/**
 * Encode a normalized relative path as a single Firestore-safe document id
 * (no slashes; stable bijection for valid planning markdown paths).
 */
export function planningRelativePathToFirestoreDocId(relativePath: string): string | null {
  const norm = normalizePlanningDocRelativePath(relativePath);
  if (!norm) return null;
  const buf = Buffer.from(norm, 'utf8');
  if (buf.length > MAX_PLANNING_RELATIVE_PATH_UTF8_BYTES) return null;
  return buf.toString('base64url');
}

/** Inverse of {@link planningRelativePathToFirestoreDocId}. */
export function planningFirestoreDocIdToRelativePath(docId: string): string | null {
  if (typeof docId !== 'string' || docId.length === 0) return null;
  try {
    const decoded = Buffer.from(docId, 'base64url').toString('utf8');
    const norm = normalizePlanningDocRelativePath(decoded);
    if (!norm || planningRelativePathToFirestoreDocId(norm) !== docId) return null;
    return norm;
  } catch {
    return null;
  }
}
