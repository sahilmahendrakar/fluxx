import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverMacEditor } from './discoverMacEditor';

describe('discoverMacEditor', () => {
  const platform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    vi.restoreAllMocks();
  });

  it('finds Cursor installs with suffixed app names', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const cliPath = '/Applications/Cursor 2.app/Contents/Resources/app/bin/cursor';
    vi.spyOn(fs, 'readdir').mockImplementation(async (dir) => {
      if (String(dir) === '/Applications') return ['Cursor 2.app', 'Safari.app'];
      return [];
    });
    vi.spyOn(fs, 'access').mockImplementation(async (p) => {
      if (String(p) === cliPath) return undefined;
      throw new Error('missing');
    });
    vi.spyOn(fs, 'stat').mockResolvedValue({
      mtimeMs: 1000,
    } as Awaited<ReturnType<typeof fs.stat>>);

    const install = await discoverMacEditor('cursor');
    expect(install).toEqual({
      openAppName: 'Cursor 2',
      cliPath,
    });
  });

  it('returns null when no matching editor app exists', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.spyOn(fs, 'readdir').mockResolvedValue(['Safari.app']);

    expect(await discoverMacEditor('vscode')).toBeNull();
  });
});
