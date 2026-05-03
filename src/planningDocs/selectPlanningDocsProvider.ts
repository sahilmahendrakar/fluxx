import type { ActiveProjectKey } from '../types';
import { CloudMirrorPlanningDocsProvider } from './cloudMirrorPlanningDocsProvider';
import type { PlanningDocsProvider } from './FilesystemPlanningDocsProvider';
import { FilesystemPlanningDocsProvider } from './FilesystemPlanningDocsProvider';

export type PlanningDocsProviderBundle = {
  localDisk: FilesystemPlanningDocsProvider;
  cloudMirror: CloudMirrorPlanningDocsProvider;
};

export function createPlanningDocsProviderBundle(
  getPlanningDir: () => string | null,
): PlanningDocsProviderBundle {
  const localDisk = new FilesystemPlanningDocsProvider(getPlanningDir, 'local-disk');
  const cloudMirror = new CloudMirrorPlanningDocsProvider(localDisk);
  return { localDisk, cloudMirror };
}

/**
 * Select the planning-docs backend for IPC. Local workspaces use authoritative
 * disk; cloud workspaces read the same tree after Firestore hydration fills it.
 */
export function planningDocsProviderForActiveProject(
  activeKey: ActiveProjectKey | null | undefined,
  bundle: PlanningDocsProviderBundle,
): PlanningDocsProvider {
  if (activeKey?.kind === 'cloud') {
    return bundle.cloudMirror;
  }
  return bundle.localDisk;
}
