import path from 'node:path';
import { ipcMain } from 'electron';
import {
  loadValidationPacksProjectConfig,
  parseElectronPlaywrightPackConfigInput,
  saveValidationPacksProjectConfig,
} from '../validationPacks/projectConfig';
import {
  isKnownValidationPackId,
  VALIDATION_PACKS_PROJECT_FILENAME,
  type ElectronPlaywrightPackProjectConfig,
  type ValidationPackId,
} from '../validationPacks/types';

export type ValidationPackProjectConfigGetResult =
  | { ok: true; path: string; config: ElectronPlaywrightPackProjectConfig | undefined }
  | { error: string };

export type ValidationPackProjectConfigSaveResult =
  | { ok: true; path: string; config: ElectronPlaywrightPackProjectConfig | undefined }
  | { error: string };

function validationPacksJsonPath(projectDir: string): string {
  return path.join(projectDir, VALIDATION_PACKS_PROJECT_FILENAME);
}

function parsePackId(
  packId: unknown,
): { ok: true; packId: ValidationPackId } | { error: string } {
  if (typeof packId !== 'string' || packId.trim().length === 0) {
    return { error: 'Invalid pack id' };
  }
  const trimmed = packId.trim();
  if (!isKnownValidationPackId(trimmed)) {
    return { error: `Unknown validation pack: ${trimmed}` };
  }
  return { ok: true, packId: trimmed };
}

export function readValidationPackProjectConfig(
  projectDir: string,
  packId: unknown,
): ValidationPackProjectConfigGetResult {
  const parsedPackId = parsePackId(packId);
  if ('error' in parsedPackId) return parsedPackId;
  try {
    const config = loadValidationPacksProjectConfig(projectDir, parsedPackId.packId);
    return { ok: true, path: validationPacksJsonPath(projectDir), config };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function writeValidationPackProjectConfig(
  projectDir: string,
  packId: unknown,
  rawConfig: unknown,
): ValidationPackProjectConfigSaveResult {
  const parsedPackId = parsePackId(packId);
  if ('error' in parsedPackId) return parsedPackId;
  const config = parseElectronPlaywrightPackConfigInput(rawConfig) ?? {};
  try {
    saveValidationPacksProjectConfig(projectDir, parsedPackId.packId, config);
    const saved = loadValidationPacksProjectConfig(projectDir, parsedPackId.packId);
    return { ok: true, path: validationPacksJsonPath(projectDir), config: saved };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function clearValidationPackProjectConfig(
  projectDir: string,
  packId: unknown,
): ValidationPackProjectConfigSaveResult {
  return writeValidationPackProjectConfig(projectDir, packId, {});
}

export function registerValidationPackProjectConfigIpc(getProjectDir: () => string): void {
  ipcMain.handle('validationPacks:getProjectConfig', async (_e, packId: unknown) =>
    readValidationPackProjectConfig(getProjectDir(), packId),
  );

  ipcMain.handle(
    'validationPacks:saveProjectConfig',
    async (_e, payload: { packId?: unknown; config?: unknown }) =>
      writeValidationPackProjectConfig(getProjectDir(), payload?.packId, payload?.config),
  );

  ipcMain.handle('validationPacks:clearProjectConfig', async (_e, packId: unknown) =>
    clearValidationPackProjectConfig(getProjectDir(), packId),
  );
}
