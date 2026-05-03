import { describe, expect, it, vi } from 'vitest';
import { CloudMirrorPlanningDocsProvider } from './cloudMirrorPlanningDocsProvider';
import type { PlanningDocsProvider } from './FilesystemPlanningDocsProvider';

describe('CloudMirrorPlanningDocsProvider', () => {
  it('delegates list and read to the inner disk provider', async () => {
    const inner: PlanningDocsProvider = {
      backendKind: 'local-disk',
      list: vi.fn(async () => ({ files: [{ relativePath: 'a.md' }] })),
      read: vi.fn(async () => ({ content: 'body' })),
    };
    const cloud = new CloudMirrorPlanningDocsProvider(inner);
    expect(cloud.backendKind).toBe('cloud-workspace-mirror-disk');

    await expect(cloud.list()).resolves.toEqual({ files: [{ relativePath: 'a.md' }] });
    await expect(cloud.read('a.md')).resolves.toEqual({ content: 'body' });
    expect(inner.list).toHaveBeenCalledTimes(1);
    expect(inner.read).toHaveBeenCalledWith('a.md');
  });
});
