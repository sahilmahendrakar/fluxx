import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureFluxBaseDirMigrated,
  FLUXX_HOME_MIGRATION_SENTINEL,
  fluxBaseDirPath,
  legacyFluxBaseDirPath,
} from './fluxBaseDir';

describe('ensureFluxBaseDirMigrated', () => {
  const homeRoots: string[] = [];

  afterEach(async () => {
    for (const home of homeRoots) {
      await fs.rm(home, { recursive: true, force: true });
    }
    homeRoots.length = 0;
  });

  function tempHome(): string {
    const home = path.join(os.tmpdir(), `fluxx-home-migrate-${process.pid}-${homeRoots.length}`);
    homeRoots.push(home);
    return home;
  }

  it('creates ~/.fluxx when neither home dir exists', async () => {
    const home = tempHome();
    const fluxx = await ensureFluxBaseDirMigrated(home);
    expect(fluxx).toBe(fluxBaseDirPath(home));
    await expect(fs.stat(fluxx)).resolves.toSatisfy((st) => st.isDirectory());
    await expect(fs.stat(legacyFluxBaseDirPath(home))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('renames ~/.flux to ~/.fluxx when only legacy exists', async () => {
    const home = tempHome();
    const legacy = legacyFluxBaseDirPath(home);
    await fs.mkdir(path.join(legacy, 'projects', 'abc'), { recursive: true });
    await fs.writeFile(path.join(legacy, 'marker.txt'), 'legacy\n', 'utf8');

    const fluxx = await ensureFluxBaseDirMigrated(home);
    expect(fluxx).toBe(fluxBaseDirPath(home));
    await expect(fs.readFile(path.join(fluxx, 'marker.txt'), 'utf8')).resolves.toBe('legacy\n');
    await expect(fs.stat(legacy)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(fluxx, FLUXX_HOME_MIGRATION_SENTINEL), 'utf8')).resolves.toContain(
      'renamed:',
    );
  });

  it('leaves existing ~/.fluxx untouched when both would exist only as fluxx', async () => {
    const home = tempHome();
    const fluxx = fluxBaseDirPath(home);
    await fs.mkdir(fluxx, { recursive: true });
    await fs.writeFile(path.join(fluxx, 'only-fluxx.txt'), '1\n', 'utf8');

    const resolved = await ensureFluxBaseDirMigrated(home);
    expect(resolved).toBe(fluxx);
    await expect(fs.readFile(path.join(fluxx, 'only-fluxx.txt'), 'utf8')).resolves.toBe('1\n');
  });
});
