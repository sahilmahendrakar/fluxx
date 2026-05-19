import type { LocalProject } from '../../types';
import { activeProjectKeyString } from '../../projectTabRestore';
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
      cloud: CloudProjectSummary;
    };

export interface BuildProjectPickerRowsInput {
  localProjects: LocalProject[];
  cloudProjects: CloudProjectSummary[];
  uid: string | null;
  /** ISO timestamps keyed by `local:<id>` / `cloud:<id>`. */
  lastOpenedAtByKey?: Record<string, string | undefined>;
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

export function projectPickerRowStateKey(row: ProjectPickerRow): string {
  return activeProjectKeyString(
    row.variant === 'team-synced'
      ? { kind: 'cloud', id: row.id }
      : { kind: 'local', id: row.id },
  );
}

function pickerRowLastOpenedAt(
  row: ProjectPickerRow,
  lastOpenedAtByKey: Record<string, string | undefined> | undefined,
): string {
  const fromMap = lastOpenedAtByKey?.[projectPickerRowStateKey(row)];
  if (fromMap) return fromMap;
  if (row.variant === 'local-only') return row.local.addedAt;
  return row.cloud.createdAt;
}

export function sortProjectPickerRowsByLastOpened(
  rows: ProjectPickerRow[],
  lastOpenedAtByKey?: Record<string, string | undefined>,
): ProjectPickerRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const aTime = pickerRowLastOpenedAt(a, lastOpenedAtByKey);
    const bTime = pickerRowLastOpenedAt(b, lastOpenedAtByKey);
    const cmp = bTime.localeCompare(aTime);
    if (cmp !== 0) return cmp;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return sorted;
}

export function filterProjectPickerRows(
  rows: ProjectPickerRow[],
  query: string,
): ProjectPickerRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(q) || row.subtitle.toLowerCase().includes(q),
  );
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

  return sortProjectPickerRowsByLastOpened(
    [...teamRows, ...localRows],
    input.lastOpenedAtByKey,
  );
}
