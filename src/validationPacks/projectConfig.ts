import fs from 'node:fs';
import path from 'node:path';
import type {
  ElectronPlaywrightPackProjectConfig,
  ValidationPackId,
  ValidationPacksProjectFile,
  ValidationReadyConfig,
} from './types';
import { VALIDATION_PACKS_PROJECT_FILENAME } from './types';

function parseReady(raw: unknown): ValidationReadyConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (type === 'selector' && typeof r.value === 'string' && r.value.trim()) {
    const out: ValidationReadyConfig = {
      type: 'selector',
      value: r.value.trim(),
    };
    if (typeof r.timeoutMs === 'number' && Number.isFinite(r.timeoutMs)) {
      out.timeoutMs = r.timeoutMs;
    }
    return out;
  }
  if (type === 'timeout' && typeof r.ms === 'number' && Number.isFinite(r.ms)) {
    return { type: 'timeout', ms: r.ms };
  }
  return undefined;
}

function parsePackConfig(raw: unknown): ElectronPlaywrightPackProjectConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: ElectronPlaywrightPackProjectConfig = {};
  if (typeof r.launchCommand === 'string' && r.launchCommand.trim()) {
    out.launchCommand = r.launchCommand.trim();
  }
  if (typeof r.worktreeCwd === 'string' && r.worktreeCwd.trim()) {
    out.worktreeCwd = r.worktreeCwd.trim();
  }
  const ready = parseReady(r.ready);
  if (ready) out.ready = ready;
  if (r.cleanUserData === true) out.cleanUserData = true;
  if (r.artifactPolicy && typeof r.artifactPolicy === 'object') {
    out.artifactPolicy = r.artifactPolicy as ElectronPlaywrightPackProjectConfig['artifactPolicy'];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseValidationPacksProjectFile(raw: string): ValidationPacksProjectFile | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const packsRaw = (parsed as ValidationPacksProjectFile).packs;
    if (!packsRaw || typeof packsRaw !== 'object') return { packs: {} };
    const packs: ValidationPacksProjectFile['packs'] = {};
    for (const [key, value] of Object.entries(packsRaw)) {
      if (key !== 'electron-playwright') continue;
      const cfg = parsePackConfig(value);
      if (cfg) packs['electron-playwright'] = cfg;
    }
    return { packs };
  } catch {
    return null;
  }
}

export function loadValidationPacksProjectConfig(
  projectDir: string,
  packId: ValidationPackId,
): ElectronPlaywrightPackProjectConfig | undefined {
  const filePath = path.join(projectDir, VALIDATION_PACKS_PROJECT_FILENAME);
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseValidationPacksProjectFile(raw);
  return parsed?.packs?.[packId];
}
