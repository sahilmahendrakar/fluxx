import type { PlanningDocsProvider } from './FilesystemPlanningDocsProvider';
import type {
  PlanningDocsBackendKind,
  PlanningDocsListResult,
  PlanningDocsReadResult,
  PlanningDocsWriteResult,
} from './types';

/**
 * Cloud workspaces mirror Firestore `planningDocs` into the on-disk `planning/` tree
 * (same folder agents use) via `usePlanningDocsFirestoreSync`; first-run conflict
 * backups and seed offers live in `cloudPlanningDocsMigration.ts` /
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

  write(relativePath: string, content: string): Promise<PlanningDocsWriteResult> {
    return this.disk.write(relativePath, content);
  }
}
