import fs from 'node:fs';
import path from 'node:path';
import type {
  ValidationPackDefinition,
  ValidationPackId,
  ValidationPackManifest,
  ValidationPackSummary,
} from './types';
import { VALIDATION_PACK_IDS } from './types';
import { resolveValidationPacksRoot } from './resolveValidationPacksRoot';

function readUtf8(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function parseManifest(raw: string, packRoot: string): ValidationPackManifest | null {
  try {
    const parsed = JSON.parse(raw) as ValidationPackManifest;
    if (parsed.id !== 'electron-playwright') return null;
    if (typeof parsed.displayName !== 'string' || typeof parsed.description !== 'string') {
      return null;
    }
    if (!Array.isArray(parsed.supportedArtifactKinds)) return null;
    if (typeof parsed.defaultInstructions !== 'string') return null;
    return { ...parsed, id: 'electron-playwright' };
  } catch {
    return null;
  }
}

function loadPackFromDisk(packId: ValidationPackId, packsRoot: string): ValidationPackDefinition | null {
  const rootDir = path.join(packsRoot, packId);
  const manifestPath = path.join(rootDir, 'manifest.json');
  const skillPath = path.join(rootDir, 'SKILL.md');
  const schemaPath = path.join(rootDir, 'verdict.schema.json');
  const templatePath = path.join(rootDir, 'templates', 'validate-electron.mjs.tpl');
  if (
    !fs.existsSync(manifestPath) ||
    !fs.existsSync(skillPath) ||
    !fs.existsSync(schemaPath) ||
    !fs.existsSync(templatePath)
  ) {
    return null;
  }
  const manifest = parseManifest(readUtf8(manifestPath), rootDir);
  if (!manifest) return null;
  return {
    manifest,
    rootDir,
    skillMarkdown: readUtf8(skillPath),
    verdictSchemaJson: readUtf8(schemaPath),
    validateElectronTemplate: readUtf8(templatePath),
  };
}

let cachedPacks: Map<ValidationPackId, ValidationPackDefinition> | null = null;
let cachedRoot: string | null = null;

function ensureCache(appPath?: string, exePath?: string): Map<ValidationPackId, ValidationPackDefinition> {
  const root = resolveValidationPacksRoot(appPath, exePath);
  if (cachedPacks && cachedRoot === root) return cachedPacks;
  const map = new Map<ValidationPackId, ValidationPackDefinition>();
  for (const id of VALIDATION_PACK_IDS) {
    const pack = loadPackFromDisk(id, root);
    if (pack) map.set(id, pack);
  }
  cachedPacks = map;
  cachedRoot = root;
  return map;
}

/** Test hook: drop in-memory pack cache. */
export function clearValidationPackCache(): void {
  cachedPacks = null;
  cachedRoot = null;
}

export function listValidationPacks(appPath?: string, exePath?: string): ValidationPackSummary[] {
  return [...ensureCache(appPath, exePath).values()].map((p) => ({
    id: p.manifest.id,
    displayName: p.manifest.displayName,
    description: p.manifest.description,
    supportedArtifactKinds: p.manifest.supportedArtifactKinds,
    defaultInstructions: p.manifest.defaultInstructions,
  }));
}

export function getValidationPackById(
  packId: string,
  appPath?: string,
  exePath?: string,
): ValidationPackDefinition | null {
  if (packId !== 'electron-playwright') return null;
  return ensureCache(appPath, exePath).get('electron-playwright') ?? null;
}

export function isValidationPackId(packId: string): packId is ValidationPackId {
  return packId === 'electron-playwright' && getValidationPackById(packId) !== null;
}
