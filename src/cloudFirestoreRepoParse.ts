import type { CloudSharedRepo } from './types';

/**
 * Validates Firestore `projects/{id}.repos[]` rows (shared team metadata).
 * Invalid entries are skipped; empty arrays return `undefined` (legacy / zero-repo).
 */
export function parseFirestoreRepos(raw: unknown): CloudSharedRepo[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CloudSharedRepo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o.id !== 'string' ||
      typeof o.name !== 'string' ||
      typeof o.baseBranch !== 'string'
    ) {
      continue;
    }
    const id = o.id.trim();
    if (!id) continue;
    const repo: CloudSharedRepo = {
      id,
      name: o.name,
      baseBranch: o.baseBranch,
    };
    if (typeof o.remoteUrl === 'string' && o.remoteUrl.trim() !== '') {
      repo.remoteUrl = o.remoteUrl.trim();
    }
    out.push(repo);
  }
  return out.length > 0 ? out : undefined;
}
