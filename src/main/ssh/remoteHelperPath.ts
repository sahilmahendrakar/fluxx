import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import {
  FLUXX_REMOTE_HELPER_VERSION,
  fluxxRemoteHelperVersionedFilename,
} from '../../remoteHelper/constants';

/** Lib modules uploaded beside the remote helper (`~/.fluxx/bin/lib/`). */
export const REMOTE_HELPER_LIB_FILENAMES = ['remoteWorktreePrep.js'] as const;

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

export function resolveBundledRemoteHelperLibPath(filename: string): string {
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'fluxx-cli', 'lib', filename));
  }
  candidates.push(path.resolve(process.cwd(), 'scripts', 'lib', filename));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Bundled remote helper lib not found: ${filename}`);
}

export async function readBundledRemoteHelperLibSources(): Promise<
  Record<(typeof REMOTE_HELPER_LIB_FILENAMES)[number], string>
> {
  const out = {} as Record<(typeof REMOTE_HELPER_LIB_FILENAMES)[number], string>;
  for (const filename of REMOTE_HELPER_LIB_FILENAMES) {
    const libPath = resolveBundledRemoteHelperLibPath(filename);
    out[filename] = await fs.readFile(libPath, 'utf8');
  }
  return out;
}

export function remoteHelperInstallPaths(version: string = FLUXX_REMOTE_HELPER_VERSION): {
  versionedFilename: string;
  mkdirScript: string;
  libMkdirScript: string;
  uploadScript: string;
  libUploadScript: (libFilename: string) => string;
  linkScript: string;
} {
  const versionedFilename = fluxxRemoteHelperVersionedFilename(version);
  return {
    versionedFilename,
    mkdirScript: 'mkdir -p "$HOME/.fluxx/bin"',
    libMkdirScript: 'mkdir -p "$HOME/.fluxx/bin/lib"',
    uploadScript: `cat > "$HOME/.fluxx/bin/${versionedFilename}"`,
    libUploadScript: (libFilename: string) =>
      `cat > "$HOME/.fluxx/bin/lib/${libFilename}"`,
    linkScript: `chmod +x "$HOME/.fluxx/bin/${versionedFilename}" && ln -sfn "${versionedFilename}" "$HOME/.fluxx/bin/fluxx-remote-helper"`,
  };
}
