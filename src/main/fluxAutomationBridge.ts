import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { existsSync } from 'node:fs';
import type { ActiveProjectKey } from '../types';
import { FLUX_CLI_BRIDGE_CONFIG_REL } from '../fluxCliBridgeConfig';
import {
  FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY_ENV,
  FLUX_AUTOMATION_TOKEN_ENV,
  FLUX_AUTOMATION_URL_ENV,
} from './fluxAutomationEnv';

export interface FluxCliBridgeConfigFile {
  url: string;
  token: string;
  expectedActiveKey: ActiveProjectKey;
}

export function newFluxAutomationToken(): string {
  return randomBytes(32).toString('hex');
}

export function fluxAutomationPtyEnv(params: {
  baseUrl: string;
  token: string;
  expectedActiveKey: ActiveProjectKey;
  fluxCliBinDir?: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    [FLUX_AUTOMATION_URL_ENV]: params.baseUrl,
    [FLUX_AUTOMATION_TOKEN_ENV]: params.token,
    [FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY_ENV]: JSON.stringify(params.expectedActiveKey),
  };
  if (params.fluxCliBinDir) {
    const sep = path.delimiter;
    const existing = process.env.PATH ?? '';
    env.PATH = existing ? `${params.fluxCliBinDir}${sep}${existing}` : params.fluxCliBinDir;
  }
  if (app.isPackaged) {
    env.FLUX_ELECTRON_EXE = process.execPath;
  }
  return env;
}

/** Directory containing the `flux` shim and `flux-cli.js` bundle. */
export function resolveFluxCliBinDir(): string | undefined {
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'flux-cli');
    if (existsSync(path.join(packaged, 'flux-cli.js'))) {
      return packaged;
    }
    return undefined;
  }
  const devBuild = path.resolve(process.cwd(), '.vite/build');
  if (existsSync(path.join(devBuild, 'flux-cli.js'))) {
    return devBuild;
  }
  return undefined;
}

export async function writeFluxCliBridgeConfig(
  projectDir: string,
  config: FluxCliBridgeConfigFile,
): Promise<void> {
  const configPath = path.join(projectDir, FLUX_CLI_BRIDGE_CONFIG_REL);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
