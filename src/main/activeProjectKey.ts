import type { ActiveProjectKey } from '../types';

export function activeProjectKeysEqual(
  a: ActiveProjectKey | null | undefined,
  b: ActiveProjectKey | null | undefined,
): boolean {
  if (a == null || b == null) return false;
  return a.kind === b.kind && a.id === b.id;
}
