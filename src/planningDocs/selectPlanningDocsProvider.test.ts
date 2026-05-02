import { describe, expect, it } from 'vitest';
import {
  createPlanningDocsProviderBundle,
  planningDocsProviderForActiveProject,
} from './selectPlanningDocsProvider';

describe('planningDocsProviderForActiveProject', () => {
  const bundle = createPlanningDocsProviderBundle(() => '/tmp/flux-unit/planning');

  it('uses authoritative local disk for local workspaces', () => {
    const p = planningDocsProviderForActiveProject({ kind: 'local', id: 'local-id' }, bundle);
    expect(p.backendKind).toBe('local-disk');
  });

  it('uses cloud mirror seam for cloud workspaces', () => {
    const p = planningDocsProviderForActiveProject({ kind: 'cloud', id: 'cloud-id' }, bundle);
    expect(p.backendKind).toBe('cloud-workspace-mirror-disk');
  });

  it('defaults to local disk when no workspace key', () => {
    const p = planningDocsProviderForActiveProject(undefined, bundle);
    expect(p.backendKind).toBe('local-disk');
  });

  it('shares one filesystem implementation between local and cloud mirror', () => {
    expect(bundle.cloudMirror).toBeDefined();
    expect(bundle.localDisk).toBeDefined();
    const cloud = planningDocsProviderForActiveProject({ kind: 'cloud', id: 'x' }, bundle);
    const local = planningDocsProviderForActiveProject({ kind: 'local', id: 'y' }, bundle);
    expect(cloud.backendKind).not.toBe(local.backendKind);
  });
});
