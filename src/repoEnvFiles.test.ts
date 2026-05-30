import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRepoBindingsRecord } from './cloudLocalBindingMigration';
import {
  REPO_ENV_FILE_ALLOWLIST,
  REPO_ENV_FILE_EXCLUDED_NAMES,
  detectRepoRootEnvFiles,
  hasLegacyPastedRepoEnv,
  isExcludedRepoEnvFileName,
  isRepoEnvFileName,
  isRepoRootEnvFilePath,
  migrateLegacyPastedEnvIfSafe,
  migrateLegacyPastedEnvToEnvFiles,
  parseRepoEnvFileSourcesConfig,
  resolveLegacyEnvMigrationKind,
} from './repoEnvFiles';
import type { RepoConfig } from './types';

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

describe('repoEnvFiles allowlist / exclusions', () => {
  it('recognizes allowlisted root env filenames', () => {
    for (const name of REPO_ENV_FILE_ALLOWLIST) {
      expect(isRepoEnvFileName(name)).toBe(true);
    }
    expect(isRepoEnvFileName('.env.example')).toBe(false);
    expect(isRepoEnvFileName('apps/.env')).toBe(false);
  });

  it('flags excluded template / production filenames', () => {
    for (const name of REPO_ENV_FILE_EXCLUDED_NAMES) {
      expect(isExcludedRepoEnvFileName(name)).toBe(true);
      expect(isRepoEnvFileName(name)).toBe(false);
    }
  });

  it('treats only direct repo-root children as root env paths', () => {
    const root = '/abs/repo';
    expect(isRepoRootEnvFilePath(root, path.join(root, '.env'))).toBe(true);
    expect(isRepoRootEnvFilePath(root, path.join(root, 'apps/web/.env'))).toBe(
      false,
    );
  });
});

describe('detectRepoRootEnvFiles', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-env-detect-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns stable rows for all allowlisted files in order', async () => {
    await fs.writeFile(path.join(tmp, '.env'), 'A=1\n', 'utf8');
    await fs.writeFile(path.join(tmp, '.env.local'), 'B=2\n', 'utf8');

    const result = await detectRepoRootEnvFiles(tmp, {
      detectedAt: '2026-05-30T00:00:00.000Z',
    });

    expect(result.repoRoot).toBe(path.resolve(tmp));
    expect(result.detectedAt).toBe('2026-05-30T00:00:00.000Z');
    expect(result.files.map((f) => f.fileName)).toEqual([...REPO_ENV_FILE_ALLOWLIST]);

    const dotEnv = result.files[0];
    expect(dotEnv.presence).toBe('found');
    expect(dotEnv.enablement).toBe('enabled');
    expect(dotEnv.sizeBytes).toBe(4);
    expect(dotEnv.contentHash).toBe(sha256Hex('A=1\n'));

    const dotEnvLocal = result.files[1];
    expect(dotEnvLocal.presence).toBe('found');
    expect(dotEnvLocal.enablement).toBe('enabled');

    for (const row of result.files.slice(2)) {
      expect(row.presence).toBe('missing');
      expect(row.enablement).toBe('disabled');
    }
  });

  it('does not treat template or production files as detected sources', async () => {
    await fs.writeFile(path.join(tmp, '.env.example'), 'EXAMPLE=1\n', 'utf8');
    await fs.writeFile(path.join(tmp, '.env.production'), 'PROD=1\n', 'utf8');
    await fs.mkdir(path.join(tmp, 'apps/web'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'apps/web/.env.local'), 'NESTED=1\n', 'utf8');

    const result = await detectRepoRootEnvFiles(tmp, {
      detectedAt: '2026-05-30T00:00:00.000Z',
    });

    expect(result.files.every((f) => f.presence === 'missing')).toBe(true);
    expect(result.files.every((f) => f.enablement === 'disabled')).toBe(true);
  });

  it('honors configured disabled enablement for found files', async () => {
    await fs.writeFile(path.join(tmp, '.env'), 'A=1\n', 'utf8');

    const result = await detectRepoRootEnvFiles(tmp, {
      envFiles: {
        sources: [{ fileName: '.env', enablement: 'disabled' }],
      },
    });

    const dotEnv = result.files.find((f) => f.fileName === '.env');
    expect(dotEnv?.presence).toBe('found');
    expect(dotEnv?.enablement).toBe('disabled');
  });

  it('disables root .env when legacy pasted env is active', async () => {
    await fs.writeFile(path.join(tmp, '.env'), 'ON_DISK=1\n', 'utf8');

    const result = await detectRepoRootEnvFiles(tmp, {
      legacyPastedEnvActive: true,
    });

    const dotEnv = result.files.find((f) => f.fileName === '.env');
    expect(dotEnv?.presence).toBe('found');
    expect(dotEnv?.enablement).toBe('disabled');
    expect(result.legacyPastedEnvActive).toBe(true);
  });
});

describe('parseRepoEnvFileSourcesConfig', () => {
  it('parses valid sources and ignores unknown filenames', () => {
    const parsed = parseRepoEnvFileSourcesConfig({
      lastDetectedAt: '2026-05-30T00:00:00.000Z',
      sources: [
        { fileName: '.env.local', enablement: 'enabled' },
        { fileName: '.env.example', enablement: 'enabled' },
        { fileName: '.env', enablement: 'not-a-state' },
      ],
    });
    expect(parsed?.lastDetectedAt).toBe('2026-05-30T00:00:00.000Z');
    expect(parsed?.sources).toEqual([
      { fileName: '.env.local', enablement: 'enabled' },
    ]);
  });
});

describe('legacy pasted env migration', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-env-migrate-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const baseRepo = (): RepoConfig => ({
    id: 'r1',
    rootPath: tmp,
    baseBranch: 'main',
    env: 'PASTED=1\n',
  });

  it('detects legacy pasted env without blocking load', () => {
    expect(hasLegacyPastedRepoEnv(baseRepo())).toBe(true);
    expect(hasLegacyPastedRepoEnv({ ...baseRepo(), env: '' })).toBe(false);
  });

  it('keeps pasted env when no root .env file exists', async () => {
    const detection = await detectRepoRootEnvFiles(tmp, {
      legacyPastedEnvActive: true,
    });
    expect(resolveLegacyEnvMigrationKind(baseRepo(), detection)).toBe('keep_pasted');

    const out = await migrateLegacyPastedEnvIfSafe(baseRepo());
    expect(out.migrated).toBe(false);
    expect(out.repo.env).toBe('PASTED=1\n');
    expect(out.repo.envFiles).toBeUndefined();
  });

  it('migrates to file sources when root .env exists', async () => {
    await fs.writeFile(path.join(tmp, '.env'), 'PASTED=1\n', 'utf8');

    const out = await migrateLegacyPastedEnvIfSafe(baseRepo());
    expect(out.migrated).toBe(true);
    expect(out.kind).toBe('enable_detected_file');
    expect(out.repo.env).toBeUndefined();
    expect(out.repo.envFiles).toEqual({
      sources: [{ fileName: '.env', enablement: 'enabled' }],
    });
  });

  it('migrateLegacyPastedEnvToEnvFiles is a no-op when envFiles already set', () => {
    const repo: RepoConfig = {
      ...baseRepo(),
      envFiles: { sources: [{ fileName: '.env.local', enablement: 'enabled' }] },
    };
    expect(migrateLegacyPastedEnvToEnvFiles(repo)).toEqual(repo);
  });
});

describe('parseRepoBindingsRecord envFiles', () => {
  it('loads envFiles from localBindings repoBindings without secret contents', () => {
    const parsed = parseRepoBindingsRecord({
      r1: {
        rootPath: '/clone/app',
        lastOpenedAt: '2026-05-30T00:00:00.000Z',
        envFiles: {
          sources: [{ fileName: '.env.local', enablement: 'enabled' }],
        },
      },
    });
    expect(parsed?.r1.envFiles).toEqual({
      sources: [{ fileName: '.env.local', enablement: 'enabled' }],
    });
  });
});
