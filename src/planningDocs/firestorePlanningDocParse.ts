import type { FirestorePlanningDocDocumentV1 } from './types';
import { revisionFromFirestoreUpdatedAt } from './firestoreRevision';

/**
 * Validates a Firestore `planningDocs` row for bulk reads (collection scan).
 * Invalid legacy rows are skipped — same rules as `fetchFirestorePlanningDocsMarkdown`.
 */
export function parseFirestorePlanningDocListRow(
  data: unknown,
): { relativePath: string; markdown: string } | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as { schemaVersion?: unknown; relativePath?: unknown; markdown?: unknown };
  if (o.schemaVersion !== 1) return null;
  if (typeof o.relativePath !== 'string' || typeof o.markdown !== 'string') return null;
  return { relativePath: o.relativePath, markdown: o.markdown };
}

/**
 * Normalizes fields from a planning doc snapshot for optimistic push / conflict handling.
 */
export function parsePlanningDocSnapshotForPush(
  data: Partial<FirestorePlanningDocDocumentV1> | undefined,
): { revision: string; markdown: string; updatedBy: string } {
  if (!data || data.schemaVersion !== 1) {
    return { revision: 'unknown', markdown: '', updatedBy: '' };
  }
  const markdown = typeof data.markdown === 'string' ? data.markdown : '';
  const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : '';
  return {
    revision: revisionFromFirestoreUpdatedAt(data.updatedAt),
    markdown,
    updatedBy,
  };
}
