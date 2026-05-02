import type { PlanningDocsProvider } from './FilesystemPlanningDocsProvider';
import type { PlanningDocsBackendKind, PlanningDocsListResult, PlanningDocsReadResult } from './types';

/**
 * Cloud planning docs today: read the local workspace mirror under
 * `.flux/<project>/planning/` (same tree as agents). When Firestore sync lands,
 * swap internals to prefer remote content while keeping this type as the seam.
 */
export class CloudMirrorPlanningDocsProvider implements PlanningDocsProvider {
  readonly backendKind: PlanningDocsBackendKind = 'cloud-workspace-mirror-disk';

  constructor(private readonly disk: PlanningDocsProvider) {}

  list(): Promise<PlanningDocsListResult> {
    return this.disk.list();
  }

  read(relativePath: string): Promise<PlanningDocsReadResult> {
    return this.disk.read(relativePath);
  }
}
