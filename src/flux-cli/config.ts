import fs from 'node:fs';
import path from 'node:path';
import type { ActiveProjectKey } from '../types';
import { FLUX_CLI_BRIDGE_CONFIG_REL } from '../fluxCliBridgeConfig';
import {
  FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY_ENV,
  FLUX_AUTOMATION_TOKEN_ENV,
  FLUX_AUTOMATION_URL_ENV,
} from '../main/fluxAutomationEnv';

export interface FluxCliBridgeConfig {
  url: string;
  token: string;
  expectedActiveKey: ActiveProjectKey;
}

function parseConfigFile(raw: string): FluxCliBridgeConfig | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { url?: unknown }).url !== 'string' ||
      typeof (parsed as { token?: unknown }).token !== 'string' ||
      !(parsed as { expectedActiveKey?: unknown }).expectedActiveKey ||
      typeof (parsed as { expectedActiveKey: ActiveProjectKey }).expectedActiveKey !== 'object'
    ) {
      return null;
    }
    const key = (parsed as { expectedActiveKey: ActiveProjectKey }).expectedActiveKey;
    if (typeof key.kind !== 'string' || typeof key.id !== 'string') {
      return null;
    }
    return {
      url: (parsed as { url: string }).url,
      token: (parsed as { token: string }).token,
      expectedActiveKey: key,
    };
  } catch {
    return null;
  }
}

function configFromEnv(): FluxCliBridgeConfig | null {
  const url = process.env[FLUX_AUTOMATION_URL_ENV]?.trim();
  const token = process.env[FLUX_AUTOMATION_TOKEN_ENV]?.trim();
  const keyRaw = process.env[FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY_ENV]?.trim();
  if (!url || !token || !keyRaw) {
    return null;
  }
  try {
    const expectedActiveKey = JSON.parse(keyRaw) as ActiveProjectKey;
    if (typeof expectedActiveKey.kind !== 'string' || typeof expectedActiveKey.id !== 'string') {
      return null;
    }
    return { url, token, expectedActiveKey };
  } catch {
    return null;
  }
}

function configFromDisk(startDir: string): FluxCliBridgeConfig | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 32; i += 1) {
    const candidate = path.join(dir, FLUX_CLI_BRIDGE_CONFIG_REL);
    if (fs.existsSync(candidate)) {
      const raw = fs.readFileSync(candidate, 'utf8');
      const parsed = parseConfigFile(raw);
      if (parsed) return parsed;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Resolve bridge settings from planning-session env or project `.flux/cli-bridge.json`. */
export function loadFluxCliBridgeConfig(cwd = process.cwd()): FluxCliBridgeConfig | null {
  return configFromEnv() ?? configFromDisk(cwd);
}
