import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSIST_TERMINALS_WITH_TMUX,
  resolvedPrefsFromBinding,
} from '../cloudBindingPrefs';
import { ProjectStore } from './ProjectStore';

async function writeConfig(projectDir: string, body: Record<string, unknown>): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'config.json'),
    `${JSON.stringify(body, null, 2)}\n`,
    'utf8',
  );
}

describe('persistTerminalsWithTmux config defaults', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-persist-tmux-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('defaults to false in cloud binding prefs', () => {
    expect(DEFAULT_PERSIST_TERMINALS_WITH_TMUX).toBe(false);
    const prefs = resolvedPrefsFromBinding({
      lastOpenedAt: 't',
      repoBindings: { r1: { rootPath: '/x', lastOpenedAt: 't' } },
      primaryRepoId: 'r1',
    });
    expect(prefs.persistTerminalsWithTmux).toBe(false);
  });

  it('reads explicit true from cloud binding', () => {
    const prefs = resolvedPrefsFromBinding({
      lastOpenedAt: 't',
      repoBindings: { r1: { rootPath: '/x', lastOpenedAt: 't' } },
      primaryRepoId: 'r1',
      persistTerminalsWithTmux: true,
    });
    expect(prefs.persistTerminalsWithTmux).toBe(true);
  });

  it('local config.json omits key → false; set/get round-trip', async () => {
    const projectDir = path.join(tmp, 'proj');
    await writeConfig(projectDir, {
      id: 'p1',
      name: 'Demo',
      rootPath: '/repo',
      addedAt: '2025-01-01T00:00:00.000Z',
      planningAgent: 'claude-code',
      defaultTaskAgent: 'claude-code',
      autoStartSessionOnInProgress: false,
      autoRespondToTrustPrompts: false,
      autoStartWhenUnblocked: false,
      autoCleanupWorkspaceWhenDone: false,
      autoMarkDoneWhenPrMerged: false,
      autoMoveToReviewWhenPrOpen: false,
      repos: [{ id: 'r1', name: 'r', rootPath: '/repo', baseBranch: 'main' }],
    });
    const store = new ProjectStore(path.join(tmp, '.fluxx'));
    expect(await store.getPersistTerminalsWithTmuxAt(projectDir)).toBe(false);
    expect(await store.setPersistTerminalsWithTmuxAt(projectDir, true)).toBe(true);
    const raw = JSON.parse(await fs.readFile(path.join(projectDir, 'config.json'), 'utf8')) as {
      persistTerminalsWithTmux?: boolean;
    };
    expect(raw.persistTerminalsWithTmux).toBe(true);
  });
});
