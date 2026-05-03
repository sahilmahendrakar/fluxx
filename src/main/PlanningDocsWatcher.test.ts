import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const mockSend = vi.fn();
  const fakeWindows = [{ isDestroyed: () => false, webContents: { send: mockSend } }];
  return {
    mockSend,
    getAllWindows: vi.fn(() => fakeWindows),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: hoisted.getAllWindows,
  },
}));

import { createPlanningDocsWatcher, notifyPlanningDocsChanged } from './PlanningDocsWatcher';

describe('PlanningDocsWatcher', () => {
  beforeEach(() => {
    hoisted.mockSend.mockClear();
    hoisted.getAllWindows.mockClear();
  });

  it('notifyPlanningDocsChanged sends planningDocs:changed to all windows', () => {
    notifyPlanningDocsChanged();
    expect(hoisted.getAllWindows).toHaveBeenCalled();
    expect(hoisted.mockSend).toHaveBeenCalledWith('planningDocs:changed');
  });

  it('debounces filesystem events into a single planningDocs:changed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-plan-watch-'));
    const planningDir = path.join(root, 'planning');
    await fs.mkdir(planningDir, { recursive: true });

    const watcher = createPlanningDocsWatcher(() => planningDir);
    watcher.sync();
    await new Promise((r) => setTimeout(r, 150));

    await fs.writeFile(path.join(planningDir, 'a.md'), '1', 'utf8');
    await fs.appendFile(path.join(planningDir, 'a.md'), '2', 'utf8');

    await vi.waitFor(
      () => {
        expect(hoisted.mockSend.mock.calls.filter((c) => c[0] === 'planningDocs:changed').length).toBeGreaterThan(
          0,
        );
      },
      { timeout: 5000 },
    );

    const n = hoisted.mockSend.mock.calls.filter((c) => c[0] === 'planningDocs:changed').length;
    expect(n).toBe(1);

    watcher.dispose();
  });

  it('dispose stops the watcher without throwing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-plan-watch2-'));
    const planningDir = path.join(root, 'planning');
    await fs.mkdir(planningDir, { recursive: true });
    const watcher = createPlanningDocsWatcher(() => planningDir);
    watcher.sync();
    watcher.dispose();
    await fs.writeFile(path.join(planningDir, 'z.md'), 'z', 'utf8');
    await new Promise((r) => setTimeout(r, 500));
  });
});
