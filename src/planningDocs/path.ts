import path from 'node:path';
import { isUnderPlanningUnsyncedPrefix } from './cloudPlanningDocsMigration';

/** Internal sync metadata under `planning/` — not editable as planning docs in-app. */
export const PLANNING_DOCS_DISK_SYNC_REL_PREFIX = '.flux-docs-sync';

const MD_SUFFIX = '.md';
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Stay under Firestore's 1500-byte document id limit after base64url expansion. */
export const MAX_PLANNING_RELATIVE_PATH_UTF8_BYTES = 1024;

function isValidPlanningSegment(seg: string): boolean {
  if (seg.length === 0) return false;
  if (seg === '.' || seg === '..') return false;
  if (seg.includes('/') || seg.includes('\\')) return false;
  return true;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += BASE64URL_ALPHABET[(n >> 18) & 63];
    out += BASE64URL_ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += BASE64URL_ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += BASE64URL_ALPHABET[n & 63];
  }
  return out;
}

function base64UrlDecode(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input) || input.length % 4 === 1) return null;

  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 4) {
    const chars = input.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const ch = chars[j];
      const value = ch ? BASE64URL_ALPHABET.indexOf(ch) : 0;
      if (value < 0) return null;
      n = (n << 6) | value;
    }
    bytes.push((n >> 16) & 255);
    if (chars.length > 2) bytes.push((n >> 8) & 255);
    if (chars.length > 3) bytes.push(n & 255);
  }
  return new Uint8Array(bytes);
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
  const bytes = new TextEncoder().encode(norm);
  if (bytes.length > MAX_PLANNING_RELATIVE_PATH_UTF8_BYTES) return null;
  return base64UrlEncode(bytes);
}

/** Inverse of {@link planningRelativePathToFirestoreDocId}. */
export function planningFirestoreDocIdToRelativePath(docId: string): string | null {
  if (typeof docId !== 'string' || docId.length === 0) return null;
  try {
    const bytes = base64UrlDecode(docId);
    if (!bytes) return null;
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const norm = normalizePlanningDocRelativePath(decoded);
    if (!norm || planningRelativePathToFirestoreDocId(norm) !== docId) return null;
    return norm;
  } catch {
    return null;
  }
}

/** True for `.flux-docs-sync/**` and `_flux_unsynced/**` (same rules as push listing). */
export function isPlanningMarkdownRelativePathForbiddenForUserWrite(relativePath: string): boolean {
  const norm = normalizePlanningDocRelativePath(relativePath);
  if (!norm) return false;
  const sync = PLANNING_DOCS_DISK_SYNC_REL_PREFIX;
  if (norm === sync || norm.startsWith(`${sync}/`)) return true;
  return isUnderPlanningUnsyncedPrefix(norm);
}
