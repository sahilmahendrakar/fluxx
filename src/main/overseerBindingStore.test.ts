import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OverseerBindingStore } from './overseerBindingStore';

describe('OverseerBindingStore', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('registers and finds a binding by repo and branch', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-overseer-'));
    const store = new OverseerBindingStore(() => tmpDir);
    const binding = await store.register({
      projectId: 'proj-1',
      repoId: 'repo-a',
      sourceBranch: 'feature/foo',
      planningSessionId: 'plan-session-1',
    });
    expect(binding.repoId).toBe('repo-a');
    const found = await store.find('repo-a', 'feature/foo');
    expect(found?.planningSessionId).toBe('plan-session-1');
  });
});
