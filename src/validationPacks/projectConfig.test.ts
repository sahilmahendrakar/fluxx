import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadValidationPacksProjectConfig,
  parseValidationPacksProjectFile,
  saveValidationPacksProjectConfig,
  serializeElectronPlaywrightPackConfigForFile,
} from './projectConfig';
import { VALIDATION_PACKS_PROJECT_FILENAME } from './types';

describe('parseValidationPacksProjectFile', () => {
  it('parses electron-playwright launch and ready config', () => {
    const parsed = parseValidationPacksProjectFile(
      JSON.stringify({
        packs: {
          'electron-playwright': {
            launchCommand: 'pnpm start:aux',
            ready: { type: 'selector', value: '[data-testid="app-shell"]' },
          },
        },
      }),
    );
    expect(parsed?.packs?.['electron-playwright']?.launchCommand).toBe('pnpm start:aux');
    expect(parsed?.packs?.['electron-playwright']?.ready?.type).toBe('selector');
  });

  it('parses and trims appendPrompt', () => {
    const parsed = parseValidationPacksProjectFile(
      JSON.stringify({
        packs: {
          'electron-playwright': {
            appendPrompt: '  Use Forge dev server.  ',
          },
        },
      }),
    );
    expect(parsed?.packs?.['electron-playwright']?.appendPrompt).toBe('Use Forge dev server.');
  });

  it('omits empty appendPrompt from parsed config', () => {
    const parsed = parseValidationPacksProjectFile(
      JSON.stringify({
        packs: {
          'electron-playwright': {
            appendPrompt: '   ',
            launchCommand: 'pnpm dev',
          },
        },
      }),
    );
    expect(parsed?.packs?.['electron-playwright']?.appendPrompt).toBeUndefined();
    expect(parsed?.packs?.['electron-playwright']?.launchCommand).toBe('pnpm dev');
  });
});

describe('serializeElectronPlaywrightPackConfigForFile', () => {
  it('omits empty appendPrompt', () => {
    expect(
      serializeElectronPlaywrightPackConfigForFile({
        launchCommand: 'pnpm start:aux',
        appendPrompt: '  ',
      }),
    ).toEqual({ launchCommand: 'pnpm start:aux' });
  });
});

describe('saveValidationPacksProjectConfig', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  it('round-trips launch, ready, cleanUserData, and appendPrompt', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-save-'));
    saveValidationPacksProjectConfig(tmp, 'electron-playwright', {
      launchCommand: 'pnpm start:aux',
      ready: { type: 'selector', value: "[data-testid='app-shell']", timeoutMs: 120_000 },
      cleanUserData: true,
      appendPrompt: 'Do not commit screenshots.',
    });

    const raw = await fs.readFile(path.join(tmp, VALIDATION_PACKS_PROJECT_FILENAME), 'utf8');
    const file = JSON.parse(raw) as { packs: Record<string, unknown> };
    expect(file.packs['electron-playwright']).toEqual({
      launchCommand: 'pnpm start:aux',
      ready: { type: 'selector', value: "[data-testid='app-shell']", timeoutMs: 120_000 },
      cleanUserData: true,
      appendPrompt: 'Do not commit screenshots.',
    });
    expect(file.packs['electron-playwright']).not.toHaveProperty('appendPrompt', '  ');

    expect(loadValidationPacksProjectConfig(tmp, 'electron-playwright')).toEqual({
      launchCommand: 'pnpm start:aux',
      ready: { type: 'selector', value: "[data-testid='app-shell']", timeoutMs: 120_000 },
      cleanUserData: true,
      appendPrompt: 'Do not commit screenshots.',
    });
  });

  it('does not write appendPrompt when empty', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-save-'));
    saveValidationPacksProjectConfig(tmp, 'electron-playwright', {
      launchCommand: 'pnpm dev',
      appendPrompt: '\n\t  ',
    });
    const loaded = loadValidationPacksProjectConfig(tmp, 'electron-playwright');
    expect(loaded?.appendPrompt).toBeUndefined();
    expect(loaded?.launchCommand).toBe('pnpm dev');
  });
});
