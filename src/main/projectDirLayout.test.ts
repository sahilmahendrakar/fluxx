import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FLUXX_MIGRATION_CONFLICT_FILE,
  FLUXX_SUPERSEDED_SENTINEL,
  LEGACY_FLUX_MIGRATION_CONFLICT_FILE,
  LEGACY_FLUX_SUPERSEDED_SENTINEL,
  markProjectDirSuperseded,
  readProjectDirMigrationConflict,
  readSupersededTarget,
  writeProjectDirMigrationConflict,
} from './projectDirLayout';

describe('projectDirLayout fluxx metadata', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  it('writes .fluxx-superseded-by and reads legacy sentinel', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-layout-'));
    const legacyDir = path.join(tmp, 'legacy');
    const canonicalDir = path.join(tmp, 'canonical');
    await fs.mkdir(legacyDir, { recursive: true });
    await markProjectDirSuperseded(legacyDir, canonicalDir);
    await expect(fs.readFile(path.join(legacyDir, FLUXX_SUPERSEDED_SENTINEL), 'utf8')).resolves.toBe(
      `${canonicalDir}\n`,
    );

    await fs.unlink(path.join(legacyDir, FLUXX_SUPERSEDED_SENTINEL));
    await fs.writeFile(path.join(legacyDir, LEGACY_FLUX_SUPERSEDED_SENTINEL), `${canonicalDir}\n`, 'utf8');
    await expect(readSupersededTarget(legacyDir)).resolves.toBe(canonicalDir);
  });

  it('writes .fluxx-migration-conflict.json and reads legacy filename', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-layout-conflict-'));
    const legacyDir = path.join(tmp, 'legacy');
    const canonicalDir = path.join(tmp, 'canonical');
    await fs.mkdir(legacyDir, { recursive: true });
    await writeProjectDirMigrationConflict({
      legacyDir,
      canonicalDir,
      reason: 'test',
    });
    await expect(fs.readFile(path.join(legacyDir, FLUXX_MIGRATION_CONFLICT_FILE), 'utf8')).resolves.toContain(
      '"reason": "test"',
    );

    await fs.unlink(path.join(legacyDir, FLUXX_MIGRATION_CONFLICT_FILE));
    await fs.writeFile(
      path.join(legacyDir, LEGACY_FLUX_MIGRATION_CONFLICT_FILE),
      `${JSON.stringify({ legacyDir, canonicalDir, reason: 'legacy-read' })}\n`,
      'utf8',
    );
    await expect(readProjectDirMigrationConflict(legacyDir)).resolves.toMatchObject({
      legacyDir,
      canonicalDir,
      reason: 'legacy-read',
    });
  });
});
