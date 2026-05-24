import fs from 'node:fs/promises';
import path from 'node:path';
import { shell } from 'electron';
import { parseValidationVerdictJson } from '../validationPacks/verdict';
import {
  normalizeValidationRunRelativePath,
  resolvePathUnderValidationRunDir,
} from '../validationRuns/path';
import type { ValidationRunStore } from './ValidationRunStore';
import { probeValidationArtifactFileState } from './ValidationRunStore';

const VERDICT_FILENAME = 'verdict.json';
const TEXT_ARTIFACT_MAX_BYTES = 512 * 1024;
const BINARY_ARTIFACT_MAX_BYTES = 8 * 1024 * 1024;

export type ValidationArtifactReadResult =
  | { ok: true; encoding: 'utf8'; content: string }
  | { ok: true; encoding: 'base64'; content: string; mimeType: string }
  | { ok: false; error: string; code: 'NOT_FOUND' | 'MISSING_FILE' | 'UNREADABLE' | 'TOO_LARGE' };

export type ValidationArtifactOpenResult =
  | { ok: true }
  | { ok: false; error: string; code: 'NOT_FOUND' | 'MISSING_FILE' | 'OPEN_FAILED' };

export type ValidationVerdictReadResult =
  | {
      ok: true;
      verdict: {
        summary: string;
        risks?: string[];
        checks?: { name: string; status: string; plannedCheckIndex?: number }[];
      };
    }
  | { ok: false; error: string; code: 'NOT_FOUND' | 'MISSING' | 'UNREADABLE' | 'INVALID' };

function guessImageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

function isTextLikeArtifact(kind: string): boolean {
  return kind === 'text' || kind === 'console-log' || kind === 'json';
}

async function resolveArtifactAbsPath(
  store: ValidationRunStore,
  runId: string,
  artifactId: string,
): Promise<
  | { ok: true; absPath: string; kind: string; fileState: Awaited<ReturnType<typeof probeValidationArtifactFileState>> }
  | { ok: false; error: string; code: 'NOT_FOUND' | 'MISSING_FILE' }
> {
  const run = await store.get(runId);
  if (!run) {
    return { ok: false, error: 'Validation run not found', code: 'NOT_FOUND' };
  }
  const artifact = run.artifacts.find((a) => a.id === artifactId);
  if (!artifact) {
    return { ok: false, error: 'Artifact not found', code: 'NOT_FOUND' };
  }
  const norm = normalizeValidationRunRelativePath(artifact.path);
  if (!norm) {
    return { ok: false, error: 'Invalid artifact path', code: 'MISSING_FILE' };
  }
  const absPath = resolvePathUnderValidationRunDir(run.artifactDir, norm);
  if (!absPath) {
    return { ok: false, error: 'Invalid artifact path', code: 'MISSING_FILE' };
  }
  const fileState = await probeValidationArtifactFileState(absPath);
  if (fileState === 'missing') {
    return { ok: false, error: 'Artifact file is missing on disk', code: 'MISSING_FILE' };
  }
  if (fileState === 'unreadable') {
    return { ok: false, error: 'Artifact file is not readable', code: 'MISSING_FILE' };
  }
  return { ok: true, absPath, kind: artifact.kind, fileState };
}

export async function readValidationArtifactForUi(
  store: ValidationRunStore,
  runId: string,
  artifactId: string,
): Promise<ValidationArtifactReadResult> {
  const resolved = await resolveArtifactAbsPath(store, runId, artifactId);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, code: resolved.code };
  }
  const { absPath, kind } = resolved;
  try {
    const st = await fs.stat(absPath);
    if (kind === 'screenshot') {
      if (st.size > BINARY_ARTIFACT_MAX_BYTES) {
        return { ok: false, error: 'Screenshot is too large to preview', code: 'TOO_LARGE' };
      }
      const buf = await fs.readFile(absPath);
      return {
        ok: true,
        encoding: 'base64',
        content: buf.toString('base64'),
        mimeType: guessImageMimeType(absPath),
      };
    }
    if (isTextLikeArtifact(kind)) {
      if (st.size > TEXT_ARTIFACT_MAX_BYTES) {
        return { ok: false, error: 'Text artifact is too large to preview inline', code: 'TOO_LARGE' };
      }
      const content = await fs.readFile(absPath, 'utf8');
      return { ok: true, encoding: 'utf8', content };
    }
    return { ok: false, error: 'Use Open externally for this artifact type', code: 'UNREADABLE' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'UNREADABLE',
    };
  }
}

export async function openValidationArtifactExternally(
  store: ValidationRunStore,
  runId: string,
  artifactId: string,
): Promise<ValidationArtifactOpenResult> {
  const resolved = await resolveArtifactAbsPath(store, runId, artifactId);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, code: resolved.code };
  }
  const err = await shell.openPath(resolved.absPath);
  if (err) {
    return { ok: false, error: err, code: 'OPEN_FAILED' };
  }
  return { ok: true };
}

export async function readValidationVerdictForUi(
  store: ValidationRunStore,
  runId: string,
): Promise<ValidationVerdictReadResult> {
  const run = await store.get(runId);
  if (!run) {
    return { ok: false, error: 'Validation run not found', code: 'NOT_FOUND' };
  }
  const verdictPath = path.join(run.artifactDir, VERDICT_FILENAME);
  let raw: string;
  try {
    raw = await fs.readFile(verdictPath, 'utf8');
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as NodeJS.ErrnoException).code
        : undefined;
    if (code === 'ENOENT') {
      return { ok: false, error: 'Verdict file not found', code: 'MISSING' };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'UNREADABLE',
    };
  }
  const parsed = parseValidationVerdictJson(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, code: 'INVALID' };
  }
  return {
    ok: true,
    verdict: {
      summary: parsed.verdict.summary,
      ...(parsed.verdict.risks?.length ? { risks: parsed.verdict.risks } : {}),
      checks: parsed.verdict.checks.map((c) => ({
        name: c.name,
        status: c.status,
        ...(typeof c.plannedCheckIndex === 'number' ? { plannedCheckIndex: c.plannedCheckIndex } : {}),
      })),
    },
  };
}
