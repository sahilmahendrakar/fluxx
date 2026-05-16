import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  migrateLegacyPlanningMarkdownIntoUserDocsDir,
  PLANNING_USER_DOCS_LEGACY_MIGRATION_STATE_BASENAME,
} from './planningUserDocsLegacyMigration';

async function mkPlanningDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-plan-udoc-mig-'));
  const planningDir = path.join(root, 'planning');
  await fs.mkdir(planningDir, { recursive: true });
  return planningDir;
}

describe('migrateLegacyPlanningMarkdownIntoUserDocsDir', () => {
  it('moves root and nested markdown into docs/ but keeps CLAUDE.md and AGENTS.md at planning root', async () => {
    const planningDir = await mkPlanningDir();
    await fs.writeFile(path.join(planningDir, 'vision.md'), 'v', 'utf8');
    await fs.mkdir(path.join(planningDir, 'notes'), { recursive: true });
    await fs.writeFile(path.join(planningDir, 'notes', 'a.md'), 'a', 'utf8');
    await fs.writeFile(path.join(planningDir, 'CLAUDE.md'), 'c', 'utf8');
    await fs.writeFile(path.join(planningDir, 'AGENTS.md'), 'g', 'utf8');

    await migrateLegacyPlanningMarkdownIntoUserDocsDir(planningDir);

    await expect(fs.readFile(path.join(planningDir, 'docs', 'vision.md'), 'utf8')).resolves.toBe('v');
    await expect(fs.readFile(path.join(planningDir, 'docs', 'notes', 'a.md'), 'utf8')).resolves.toBe('a');
    await expect(fs.readFile(path.join(planningDir, 'CLAUDE.md'), 'utf8')).resolves.toBe('c');
    await expect(fs.readFile(path.join(planningDir, 'AGENTS.md'), 'utf8')).resolves.toBe('g');
    await expect(fs.access(path.join(planningDir, 'vision.md'))).rejects.toMatchObject({ code: 'ENOENT' });

    const raw = await fs.readFile(path.join(planningDir, PLANNING_USER_DOCS_LEGACY_MIGRATION_STATE_BASENAME), 'utf8');
    const st = JSON.parse(raw) as { migratedPaths: string[] };
    expect(st.migratedPaths.sort()).toEqual(['notes/a.md', 'vision.md']);
  });

  it('does not re-run after state exists (new legacy files stay put)', async () => {
    const planningDir = await mkPlanningDir();
    await fs.writeFile(path.join(planningDir, 'x.md'), '1', 'utf8');
    await migrateLegacyPlanningMarkdownIntoUserDocsDir(planningDir);
    await fs.writeFile(path.join(planningDir, 'y.md'), '2', 'utf8');
    await migrateLegacyPlanningMarkdownIntoUserDocsDir(planningDir);

    await expect(fs.access(path.join(planningDir, 'y.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(planningDir, 'docs', 'x.md'))).resolves.toBeUndefined();
  });

  it('when docs/ already has identical bytes, removes the legacy duplicate', async () => {
    const planningDir = await mkPlanningDir();
    await fs.mkdir(path.join(planningDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(planningDir, 'docs', 'same.md'), 'body', 'utf8');
    await fs.writeFile(path.join(planningDir, 'same.md'), 'body', 'utf8');

    await migrateLegacyPlanningMarkdownIntoUserDocsDir(planningDir);

    await expect(fs.access(path.join(planningDir, 'same.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(planningDir, 'docs', 'same.md'), 'utf8')).resolves.toBe('body');
  });

  it('when docs/ has different content, keeps legacy file and records skip', async () => {
    const planningDir = await mkPlanningDir();
    await fs.mkdir(path.join(planningDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(planningDir, 'docs', 'dup.md'), 'in-docs', 'utf8');
    await fs.writeFile(path.join(planningDir, 'dup.md'), 'legacy', 'utf8');

    await migrateLegacyPlanningMarkdownIntoUserDocsDir(planningDir);

    await expect(fs.readFile(path.join(planningDir, 'dup.md'), 'utf8')).resolves.toBe('legacy');
    await expect(fs.readFile(path.join(planningDir, 'docs', 'dup.md'), 'utf8')).resolves.toBe('in-docs');

    const raw = await fs.readFile(path.join(planningDir, PLANNING_USER_DOCS_LEGACY_MIGRATION_STATE_BASENAME), 'utf8');
    const st = JSON.parse(raw) as { skippedDestExists: string[] };
    expect(st.skippedDestExists).toEqual(['dup.md']);
  });
});
