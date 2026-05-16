import path from 'node:path';
import { isPlanningInstructionSeedFile, isUnderPlanningUnsyncedPrefix } from './cloudPlanningDocsMigration';
import { PLANNING_INSTRUCTIONS_STATE_BASENAME } from './planningInstructionMarkers';

/** Internal sync metadata under `planning/` — not editable as planning docs in-app. */
export const PLANNING_DOCS_DISK_SYNC_REL_PREFIX = '.flux-docs-sync';

/** User-facing planning markdown lives under `<planningDir>/docs/` (agents stay at `<planningDir>/`). */
export const PLANNING_USER_DOCS_REL_SEGMENT = 'docs';

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
  let segments = slash.split('/');
  if (segments.length === 0) return null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!isValidPlanningSegment(seg)) return null;
  }
  /** Accept `docs/foo.md` (planning workspace cwd); canonical form is relative to `planning/docs/`. */
  if (segments[0] === PLANNING_USER_DOCS_REL_SEGMENT) {
    segments = segments.slice(1);
    if (segments.length === 0) return null;
  }
  const last = segments[segments.length - 1];
  if (!last.toLowerCase().endsWith(MD_SUFFIX)) return null;
  return segments.join('/');
}

export function planningUserDocsDir(planningDir: string): string {
  return path.join(planningDir, PLANNING_USER_DOCS_REL_SEGMENT);
}

function resolveMarkdownUnderBaseDir(baseDir: string, norm: string): string | null {
  const candidate = path.resolve(baseDir, ...norm.split('/'));
  const resolvedRoot = path.resolve(baseDir);
  if (candidate === resolvedRoot) return null;
  const relCheck = path.relative(resolvedRoot, candidate);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return null;
  return candidate;
}

/** True for `.flux-docs-sync/**` and `_flux_unsynced/**` (same rules as push listing). */
export function isPlanningMarkdownRelativePathForbiddenForUserWrite(relativePath: string): boolean {
  const norm = normalizePlanningDocRelativePath(relativePath);
  if (!norm) return false;
  const sync = PLANNING_DOCS_DISK_SYNC_REL_PREFIX;
  if (norm === sync || norm.startsWith(`${sync}/`)) return true;
  return isUnderPlanningUnsyncedPrefix(norm);
}

/** Reserved agent/runtime markdown or paths that must never be user planning docs. */
export function isPlanningUserDocRelativePathDisallowed(norm: string): boolean {
  if (isPlanningMarkdownRelativePathForbiddenForUserWrite(norm)) return true;
  if (norm === PLANNING_INSTRUCTIONS_STATE_BASENAME) return true;
  const segments = norm.split('/');
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (lower === 'claude.md' || lower === 'agents.md') return true;
    if (seg === '.cursor') return true;
  }
  return false;
}

/**
 * Legacy layout: markdown directly under `planning/` (outside `planning/docs/`).
 * Used only for read/list compatibility until content is recreated under `docs/`.
 */
export function planningLegacyUserMarkdownAbsPath(planningDir: string, norm: string): string | null {
  if (!norm || isPlanningUserDocRelativePathDisallowed(norm)) return null;
  if (isPlanningInstructionSeedFile(norm)) return null;
  const candidate = resolveMarkdownUnderBaseDir(planningDir, norm);
  if (!candidate) return null;
  const relCheck = path.relative(path.resolve(planningDir), candidate).split(path.sep).join('/');
  if (relCheck === PLANNING_USER_DOCS_REL_SEGMENT || relCheck.startsWith(`${PLANNING_USER_DOCS_REL_SEGMENT}/`)) {
    return null;
  }
  return candidate;
}

/**
 * Resolve a normalized user planning markdown path for disk reads (canonical `docs/`
 * first, then legacy `planning/` outside `docs/`).
 */
export async function resolvePlanningUserMarkdownAbsPathForRead(
  planningDir: string,
  norm: string,
  fsAccess: (p: string) => Promise<void>,
): Promise<string | null> {
  if (!norm || isPlanningUserDocRelativePathDisallowed(norm) || isPlanningInstructionSeedFile(norm)) {
    return null;
  }
  const canonical = resolveMarkdownUnderBaseDir(planningUserDocsDir(planningDir), norm);
  if (canonical) {
    try {
      await fsAccess(canonical);
      return canonical;
    } catch {
      /* try legacy */
    }
  }
  const legacy = planningLegacyUserMarkdownAbsPath(planningDir, norm);
  if (!legacy) return null;
  try {
    await fsAccess(legacy);
    return legacy;
  } catch {
    return null;
  }
}

/**
 * Resolve `relativePath` for persisted planning markdown.
 *
 * - `_flux_unsynced/**` and instruction seeds (`CLAUDE.md`, `AGENTS.md`) stay under
 *   `planningDir` (agent workspace root).
 * - All other user docs resolve under `planningDir/docs/`.
 *
 * Legacy files outside `docs/` are *not* returned here — use
 * {@link planningLegacyUserMarkdownAbsPath} or {@link resolvePlanningUserMarkdownAbsPathForRead}.
 */
export function safeResolvePlanningMarkdownAbsPath(
  planningDir: string,
  relativePath: string,
): string | null {
  const norm = normalizePlanningDocRelativePath(relativePath);
  if (!norm) return null;
  if (isUnderPlanningUnsyncedPrefix(norm)) {
    return resolveMarkdownUnderBaseDir(planningDir, norm);
  }
  if (isPlanningInstructionSeedFile(norm)) {
    return resolveMarkdownUnderBaseDir(planningDir, norm);
  }
  if (isPlanningUserDocRelativePathDisallowed(norm)) return null;
  return resolveMarkdownUnderBaseDir(planningUserDocsDir(planningDir), norm);
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

/**
 * True when a path must not be attached to tasks, listed in Docs, or written via the
 * planning-docs provider (includes sync internals and agent/runtime paths).
 */
export function isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite(relativePath: string): boolean {
  const norm = normalizePlanningDocRelativePath(relativePath);
  if (!norm) return false;
  return isPlanningUserDocRelativePathDisallowed(norm) || isPlanningInstructionSeedFile(norm);
}
