import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearValidationPackProjectConfig,
  readValidationPackProjectConfig,
  writeValidationPackProjectConfig,
} from './validationPackProjectConfigIpc';
import { VALIDATION_PACKS_PROJECT_FILENAME } from '../validationPacks/types';

describe('validationPackProjectConfigIpc', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  it('returns empty config when validation-packs.json is missing', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-ipc-'));
    const result = readValidationPackProjectConfig(tmp, 'electron-playwright');
    expect(result).toEqual({
      ok: true,
      path: path.join(tmp, VALIDATION_PACKS_PROJECT_FILENAME),
      config: undefined,
    });
  });

  it('round-trips launch, ready, cleanUserData, and appendPrompt via IPC helpers', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-ipc-'));
    const payload = {
      launchCommand: 'pnpm start:aux',
      ready: { type: 'selector', value: "[data-testid='app-shell']", timeoutMs: 120_000 },
      cleanUserData: true,
      appendPrompt: 'Project validation notes for every run.',
    };

    const saved = writeValidationPackProjectConfig(tmp, 'electron-playwright', payload);
    expect(saved).toEqual({
      ok: true,
      path: path.join(tmp, VALIDATION_PACKS_PROJECT_FILENAME),
      config: payload,
    });

    const loaded = readValidationPackProjectConfig(tmp, 'electron-playwright');
    expect(loaded).toEqual({
      ok: true,
      path: path.join(tmp, VALIDATION_PACKS_PROJECT_FILENAME),
      config: payload,
    });

    const raw = await fs.readFile(path.join(tmp, VALIDATION_PACKS_PROJECT_FILENAME), 'utf8');
    expect(JSON.parse(raw)).toEqual({
      packs: {
        'electron-playwright': payload,
      },
    });
  });

  it('clear removes saved pack config', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-ipc-'));
    writeValidationPackProjectConfig(tmp, 'electron-playwright', {
      launchCommand: 'pnpm dev',
      appendPrompt: 'Notes',
    });

    const cleared = clearValidationPackProjectConfig(tmp, 'electron-playwright');
    expect(cleared).toEqual({
      ok: true,
      path: path.join(tmp, VALIDATION_PACKS_PROJECT_FILENAME),
      config: undefined,
    });

    const loaded = readValidationPackProjectConfig(tmp, 'electron-playwright');
    expect(loaded).toEqual({
      ok: true,
      path: path.join(tmp, VALIDATION_PACKS_PROJECT_FILENAME),
      config: undefined,
    });
  });

  it('rejects unknown pack ids', () => {
    expect(readValidationPackProjectConfig('/tmp', 'unknown-pack')).toEqual({
      error: 'Unknown validation pack: unknown-pack',
    });
  });
});
