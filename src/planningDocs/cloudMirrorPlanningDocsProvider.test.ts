import { describe, expect, it, vi } from 'vitest';
import { CloudMirrorPlanningDocsProvider } from './cloudMirrorPlanningDocsProvider';
import type { PlanningDocsProvider } from './FilesystemPlanningDocsProvider';

describe('CloudMirrorPlanningDocsProvider', () => {
  it('delegates list, read, and write to the inner disk provider', async () => {
    const inner: PlanningDocsProvider = {
      backendKind: 'local-disk',
      list: vi.fn(async () => ({ files: [{ relativePath: 'a.md' }] })),
      read: vi.fn(async () => ({ content: 'body' })),
      write: vi.fn(async () => ({ ok: true as const })),
    };
    const cloud = new CloudMirrorPlanningDocsProvider(inner);
    expect(cloud.backendKind).toBe('cloud-workspace-mirror-disk');

    await expect(cloud.list()).resolves.toEqual({ files: [{ relativePath: 'a.md' }] });
    await expect(cloud.read('a.md')).resolves.toEqual({ content: 'body' });
    await expect(cloud.write('a.md', 'next')).resolves.toEqual({ ok: true });
    expect(inner.list).toHaveBeenCalledTimes(1);
    expect(inner.read).toHaveBeenCalledWith('a.md');
    expect(inner.write).toHaveBeenCalledWith('a.md', 'next');
  });
});
