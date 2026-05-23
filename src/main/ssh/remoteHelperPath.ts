import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import {
  FLUXX_REMOTE_HELPER_VERSION,
  fluxxRemoteHelperVersionedFilename,
} from '../../remoteHelper/constants';

export function resolveBundledRemoteHelperPath(): string {
  const versioned = fluxxRemoteHelperVersionedFilename();
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'fluxx-cli', versioned));
  }
  candidates.push(path.resolve(process.cwd(), 'scripts', versioned));
  candidates.push(path.resolve(process.cwd(), 'scripts', 'fluxx-remote-helper.js'));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Bundled remote helper not found (expected ${versioned})`);
}

export async function readBundledRemoteHelperSource(): Promise<string> {
  const helperPath = resolveBundledRemoteHelperPath();
  return await fs.readFile(helperPath, 'utf8');
}

export function remoteHelperInstallPaths(version: string = FLUXX_REMOTE_HELPER_VERSION): {
  versionedFilename: string;
  mkdirScript: string;
  uploadScript: string;
  linkScript: string;
} {
  const versionedFilename = fluxxRemoteHelperVersionedFilename(version);
  return {
    versionedFilename,
    mkdirScript: 'mkdir -p "$HOME/.fluxx/bin"',
    uploadScript: `cat > "$HOME/.fluxx/bin/${versionedFilename}"`,
    linkScript: `chmod +x "$HOME/.fluxx/bin/${versionedFilename}" && ln -sfn "${versionedFilename}" "$HOME/.fluxx/bin/fluxx-remote-helper"`,
  };
}
