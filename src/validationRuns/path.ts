import path from 'node:path';

function isValidRunRelativeSegment(seg: string): boolean {
  if (seg.length === 0) return false;
  if (seg === '.' || seg === '..') return false;
  if (seg.includes('/') || seg.includes('\\')) return false;
  return true;
}

/**
 * Normalizes a run-relative path (forward slashes, no `..` traversal).
 * Returns null when the path would escape the run directory.
 */
export function normalizeValidationRunRelativePath(input: string): string | null {
  if (typeof input !== 'string' || input.includes('\0')) return null;
  const slash = input.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (slash.length === 0) return null;
  const segments = slash.split('/');
  for (const seg of segments) {
    if (!isValidRunRelativeSegment(seg)) return null;
  }
  return segments.join('/');
}

/** Resolves `norm` under `runDir`; returns null when normalized path escapes `runDir`. */
export function resolvePathUnderValidationRunDir(runDir: string, norm: string): string | null {
  const candidate = path.resolve(runDir, ...norm.split('/'));
  const resolvedRoot = path.resolve(runDir);
  if (candidate === resolvedRoot) return null;
  const relCheck = path.relative(resolvedRoot, candidate);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return null;
  return candidate;
}

export const VALIDATION_RUNS_REL_DIR = 'validation-runs';

export function validationRunDir(projectDir: string, runId: string): string {
  return path.join(projectDir, VALIDATION_RUNS_REL_DIR, runId);
}

export const VALIDATION_RUN_ARTIFACT_SUBDIRS = [
  'artifacts/screenshots',
  'artifacts/traces',
  'artifacts/videos',
  'artifacts/logs',
  'artifacts/data',
] as const;
