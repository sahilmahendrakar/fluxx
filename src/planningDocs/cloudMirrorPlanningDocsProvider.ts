import type { PlanningDocsProvider } from './FilesystemPlanningDocsProvider';
import type { PlanningDocsBackendKind, PlanningDocsListResult, PlanningDocsReadResult } from './types';

/**
 * Cloud planning docs today: read the local workspace mirror under
 * `.flux/<project>/planning/` (same tree as agents). Firestore-backed sync
 * hydrates that mirror on first open — see `cloudPlanningDocsMigration.ts` and
 * `useCloudPlanningDocsMigration.tsx`.
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
