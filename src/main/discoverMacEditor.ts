import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type MacEditorKind = 'cursor' | 'vscode';

export interface MacEditorInstall {
  /** Application name for `open -a` (e.g. `Cursor 2`, `Visual Studio Code`). */
  openAppName: string;
  /** Bundled CLI inside the .app (e.g. `.../Cursor 2.app/.../bin/cursor`). */
  cliPath: string;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function matchesEditorApp(entry: string, kind: MacEditorKind): boolean {
  if (!entry.endsWith('.app')) return false;
  if (kind === 'cursor') return /^cursor(\s+\d+)?\.app$/i.test(entry);
  return /^visual studio code(\s+\d+)?\.app$/i.test(entry);
}

function cliBinary(kind: MacEditorKind): string {
  return kind === 'cursor' ? 'cursor' : 'code';
}

/**
 * Finds a Cursor or VS Code install under `/Applications` and `~/Applications`.
 * Supports suffixed app names like `Cursor 2.app` from macOS duplicate installs.
 */
export async function discoverMacEditor(kind: MacEditorKind): Promise<MacEditorInstall | null> {
  if (process.platform !== 'darwin') return null;

  const roots = ['/Applications', path.join(os.homedir(), 'Applications')];
  const candidates: { install: MacEditorInstall; mtimeMs: number }[] = [];

  for (const root of roots) {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!matchesEditorApp(entry, kind)) continue;
      const cliPath = path.join(
        root,
        entry,
        'Contents/Resources/app/bin',
        cliBinary(kind),
      );
      if (!(await pathExists(cliPath))) continue;
      const appPath = path.join(root, entry);
      const st = await fs.stat(appPath);
      candidates.push({
        install: {
          openAppName: entry.replace(/\.app$/i, ''),
          cliPath,
        },
        mtimeMs: st.mtimeMs,
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]!.install;
}
