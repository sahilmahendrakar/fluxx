import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  PlanningDocFileEntry,
  PlanningDocsBackendKind,
  PlanningDocsListResult,
  PlanningDocsReadResult,
  PlanningDocsWriteResult,
} from './types';
import { isPlanningInstructionSeedFile } from './cloudPlanningDocsMigration';
import {
  isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite,
  isPlanningUserDocRelativePathDisallowed,
  normalizePlanningDocRelativePath,
  planningUserDocsDir,
  resolvePlanningUserMarkdownAbsPathForRead,
  safeResolvePlanningMarkdownAbsPath,
} from './path';
import { isPlanningDiskSyncDirName } from './fluxxPlanningPaths';
import { migrateLegacyPlanningMarkdownIntoUserDocsDir } from './planningUserDocsLegacyMigration';

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
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
    if (ent.isDirectory()) {
      out.push(...(await collectMarkdownRelPaths(full, rel)));
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
      out.push(rel.split(path.sep).join('/'));
    }
  }
  return out;
}

/** Markdown under `planning/` but outside `docs/` and reserved dirs (legacy compat). */
async function collectLegacyMarkdownRelPathsOutsideDocs(planningDir: string): Promise<string[]> {
  async function walk(dir: string, base: string): Promise<string[]> {
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
      if (ent.isDirectory()) {
        if (
          ent.name === 'docs' ||
          isPlanningDiskSyncDirName(ent.name) ||
          ent.name === '_flux_unsynced' ||
          ent.name === '.cursor'
        ) {
          continue;
        }
        out.push(...(await walk(full, rel)));
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        const norm = normalizePlanningDocRelativePath(relSlash);
        if (!norm || isPlanningUserDocRelativePathDisallowed(norm) || isPlanningInstructionSeedFile(norm)) {
          continue;
        }
        out.push(relSlash);
      }
    }
    return out;
  }
  return walk(planningDir, '');
}

export interface PlanningDocsProvider {
  readonly backendKind: PlanningDocsBackendKind;
  list(): Promise<PlanningDocsListResult>;
  read(relativePath: string): Promise<PlanningDocsReadResult>;
  write(relativePath: string, content: string): Promise<PlanningDocsWriteResult>;
}

export class FilesystemPlanningDocsProvider implements PlanningDocsProvider {
  constructor(
    private readonly getPlanningDir: () => string | null,
    readonly backendKind: PlanningDocsBackendKind,
  ) {}

  async list(): Promise<PlanningDocsListResult> {
    const planningDir = this.getPlanningDir();
    if (!planningDir) {
      return { error: 'NO_PROJECT' };
    }
    try {
      await fs.mkdir(planningDir, { recursive: true });
      await fs.mkdir(planningUserDocsDir(planningDir), { recursive: true });
      await migrateLegacyPlanningMarkdownIntoUserDocsDir(planningDir);
    } catch {
      return { error: 'IO_ERROR' };
    }
    const userDocsDir = planningUserDocsDir(planningDir);
    const canonical = await collectMarkdownRelPaths(userDocsDir, '');
    const legacy = await collectLegacyMarkdownRelPathsOutsideDocs(planningDir);
    const canonicalSet = new Set(canonical);
    const merged: string[] = [...canonical];
    for (const p of legacy) {
      if (canonicalSet.has(p)) continue;
      merged.push(p);
    }
    merged.sort((a, b) => a.localeCompare(b));
    const files: PlanningDocFileEntry[] = merged.map((p) => ({
      relativePath: p,
    }));
    return { files };
  }

  async read(relativePath: string): Promise<PlanningDocsReadResult> {
    const planningDir = this.getPlanningDir();
    if (!planningDir) {
      return { error: 'NO_PROJECT' };
    }
    const norm = normalizePlanningDocRelativePath(relativePath);
    if (!norm || isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite(relativePath)) {
      return { error: 'INVALID_PATH' };
    }
    const filePath = await resolvePlanningUserMarkdownAbsPathForRead(planningDir, norm, (p) =>
      fs.access(p),
    );
    if (!filePath) {
      return { error: 'NOT_FOUND' };
    }
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return { content };
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') return { error: 'NOT_FOUND' };
      return { error: 'READ_FAILED' };
    }
  }

  async write(relativePath: string, content: string): Promise<PlanningDocsWriteResult> {
    if (typeof content !== 'string' || content.includes('\0')) {
      return { error: 'INVALID_CONTENT' };
    }
    const planningDir = this.getPlanningDir();
    if (!planningDir) {
      return { error: 'NO_PROJECT' };
    }
    const norm = normalizePlanningDocRelativePath(relativePath);
    if (!norm) {
      return { error: 'INVALID_PATH' };
    }
    if (isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite(relativePath)) {
      return { error: 'FORBIDDEN_PATH' };
    }
    const filePath = safeResolvePlanningMarkdownAbsPath(planningDir, relativePath);
    if (!filePath) {
      return { error: 'INVALID_PATH' };
    }
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
      return { ok: true };
    } catch {
      return { error: 'IO_ERROR' };
    }
  }
}
