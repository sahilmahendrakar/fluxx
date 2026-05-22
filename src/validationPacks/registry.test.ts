import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearValidationPackCache,
  getValidationPackById,
  isValidationPackId,
  listValidationPacks,
} from './registry';
import { setValidationPacksRootOverride } from './resolveValidationPacksRoot';

describe('validationPacks/registry', () => {
  afterEach(() => {
    setValidationPacksRootOverride(undefined);
    clearValidationPackCache();
  });

  it('loads electron-playwright pack from repo validation-packs/', () => {
    const root = path.resolve(process.cwd(), 'validation-packs');
    setValidationPacksRootOverride(root);
    clearValidationPackCache();

    const packs = listValidationPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]?.id).toBe('electron-playwright');
    expect(packs[0]?.displayName).toBe('Electron Playwright');
    expect(packs[0]?.supportedArtifactKinds).toContain('screenshot');

    expect(isValidationPackId('electron-playwright')).toBe(true);
    expect(isValidationPackId('web-playwright')).toBe(false);

    const pack = getValidationPackById('electron-playwright');
    expect(pack?.skillMarkdown).toContain('validator');
    expect(pack?.verdictSchemaJson).toContain('"verdict"');
    expect(pack?.validateElectronTemplate).toContain('{{RUN_ID}}');
  });
});
