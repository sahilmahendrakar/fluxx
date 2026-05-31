import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveValidationPacksProjectConfig } from './projectConfig';
import { resolveValidationPackConfig } from './resolveValidationPackConfig';

describe('resolveValidationPackConfig', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  it('returns empty object when validation-packs.json is missing', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-resolve-empty-'));
    expect(resolveValidationPackConfig({ projectDir: tmp, packId: 'electron-playwright' })).toEqual(
      {},
    );
  });

  it('returns saved pack config including appendPrompt', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-resolve-'));
    saveValidationPacksProjectConfig(tmp, 'electron-playwright', {
      launchCommand: 'pnpm start:aux',
      appendPrompt: '  Prefer data-testid locators.  ',
    });
    expect(resolveValidationPackConfig({ projectDir: tmp, packId: 'electron-playwright' })).toEqual(
      {
        launchCommand: 'pnpm start:aux',
        appendPrompt: 'Prefer data-testid locators.',
      },
    );
  });
});
