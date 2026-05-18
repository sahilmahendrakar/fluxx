import { cloudProjectNeedsRepoBinding } from '../../cloudProjectActivation';
import type { CloudProjectLocalBinding, LocalProject } from '../../types';
import type { CloudProjectSummary } from './cloudProjects';

export type ProjectPickerSyncBadge = 'local' | 'team-synced';

export type ProjectPickerRow =
  | {
      variant: 'local-only';
      id: string;
      name: string;
      subtitle: string;
      syncBadge: 'local';
      local: LocalProject;
    }
  | {
      variant: 'team-synced';
      id: string;
      name: string;
      subtitle: string;
      syncBadge: 'team-synced';
      needsRepo: boolean;
      cloud: CloudProjectSummary;
    };

export interface BuildProjectPickerRowsInput {
  localProjects: LocalProject[];
  cloudProjects: CloudProjectSummary[];
  cloudBindingsById: Record<string, CloudProjectLocalBinding | null | undefined>;
  uid: string | null;
}

/** Secondary line for local-only picker rows. */
export function localProjectPickerSubtitle(project: LocalProject): string {
  if (project.repos.length === 0) {
    return 'No repository yet';
  }
  return project.rootPath;
}

/** Secondary line for team-synced picker rows. */
export function teamProjectPickerSubtitle(
  summary: CloudProjectSummary,
  uid: string | null,
): string {
  const n = summary.memberIds.length;
  const members = `member${n === 1 ? '' : 's'}`;
  if (uid && summary.ownerId === uid) {
    return `Owner · ${n} ${members}`;
  }
  return `Member · ${n} ${members}`;
}

/**
 * One picker row per project: team-synced Firestore projects plus local-only
 * discoveries. Materialized team workspaces are deduped (same id as cloud).
 */
export function buildProjectPickerRows(
  input: BuildProjectPickerRowsInput,
): ProjectPickerRow[] {
  const teamSyncedIds = new Set(input.cloudProjects.map((p) => p.id));

  const teamRows: ProjectPickerRow[] = input.cloudProjects.map((cloud) => ({
    variant: 'team-synced',
    id: cloud.id,
    name: cloud.name,
    subtitle: teamProjectPickerSubtitle(cloud, input.uid),
    syncBadge: 'team-synced',
    needsRepo: cloudProjectNeedsRepoBinding(
      cloud.id,
      cloud.repos,
      input.cloudBindingsById[cloud.id],
    ),
    cloud,
  }));

  const localRows: ProjectPickerRow[] = input.localProjects
    .filter((local) => !teamSyncedIds.has(local.id))
    .map((local) => ({
      variant: 'local-only',
      id: local.id,
      name: local.name,
      subtitle: localProjectPickerSubtitle(local),
      syncBadge: 'local',
      local,
    }));

  const rows = [...teamRows, ...localRows];
  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return rows;
}
