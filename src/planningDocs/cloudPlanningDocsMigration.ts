/**
 * Cloud planning-docs migration / first-sync behavior
 * ====================================================
 *
 * When a cloud Firestore project gains a `projects/{id}/planningDocs/*` mirror of the
 * local planning markdown tree (canonical under `planning/docs/**`, with legacy
 * top-level files still readable until migrated), we must avoid silent data loss:
 *
 * - **Firestore already has docs:** Treat Firestore as canonical on first hydration.
 *   Local files that differ are copied under `_flux_unsynced/<same-relative-path>`
 *   before the canonical tree is overwritten from Firestore. Upload pipelines must
 *   never push `_flux_unsynced/**` as shared docs.
 *
 * - **Firestore is empty but local planning has markdown:** Offer once to **seed**
 *   shared docs from local files (explicit opt-in). Declining records resolution so
 *   we do not nag; nothing is uploaded automatically.
 *
 * - **New teammates:** Cloud activation materialises `planning/` under
 *   `~/.flux/projects/<cloudProjectId>/` and may seed `CLAUDE.md` / `AGENTS.md` with
 *   machine-specific paths. Shared planning markdown is written under `planning/docs/`.
 *   Those instruction bodies often differ only by embedded workspace paths — see
 *   {@link planningMarkdownEquivalentForSeededInstructions}. Treating them as equivalent
 *   avoids noisy conflict copies while still replacing with shared content when Firestore
 *   has the team version.
 *
 * Persisted completion flags: `planning/.flux-cloud-docs-migration.json`
 * (`planningDocsMigrationDisk.ts`). Renderer orchestration: `useCloudPlanningDocsMigration.tsx`.
 * Firestore IO: `renderer/planningDocs/firestorePlanningDocs.ts`.
 */

/** Local-only tree for divergent copies preserved during Firestore-first hydration. */
export const PLANNING_CLOUD_UNSYNCED_PREFIX = '_flux_unsynced';

export type PlanningDocsMigrationScenario =
  | 'both_empty'
  | 'firestore_only'
  | 'local_only'
  | 'both_present';

export function classifyPlanningDocsMigrationScenario(input: {
  firestorePaths: string[];
  localPaths: string[];
}): PlanningDocsMigrationScenario {
  const fr = input.firestorePaths.length > 0;
  const loc = input.localPaths.length > 0;
  if (fr && loc) return 'both_present';
  if (fr) return 'firestore_only';
  if (loc) return 'local_only';
  return 'both_empty';
}

const ROOT_INSTRUCTION_FILES = new Set(['CLAUDE.md', 'AGENTS.md']);

export function isPlanningInstructionSeedFile(relativePath: string): boolean {
  return ROOT_INSTRUCTION_FILES.has(relativePath);
}

/**
 * Normalizes markdown that embeds absolute workspace paths in backticks (as the seeded
 * CLAUDE/AGENTS templates do) so two teammates can compare instruction bodies without
 * trivial path-only drift.
 */
export function normalizePlanningInstructionHeading(markdown: string): string {
  return markdown.replace(/^#\s+Planning workspace — .*$/m, '# Planning workspace — __FLUX_NAME__');
}

export function normalizePlanningMarkdownEmbeddedPaths(markdown: string): string {
  const unified = markdown.replace(/\r\n/g, '\n');
  return unified.replace(/`([^`\n]*)`/g, (_m, inner: string) => {
    const t = inner.trim();
    if (
      t.includes('/') ||
      t.includes('\\') ||
      /^[A-Za-z]:[\\/]/.test(t) ||
      t.startsWith('\\\\')
    ) {
      return '`__FLUX_EMBEDDED_PATH__`';
    }
    return `\`${inner}\``;
  });
}

export function planningMarkdownEquivalentForSeededInstructions(
  relativePath: string,
  a: string,
  b: string,
): boolean {
  if (!isPlanningInstructionSeedFile(relativePath)) return false;
  const na = normalizePlanningMarkdownEmbeddedPaths(normalizePlanningInstructionHeading(a));
  const nb = normalizePlanningMarkdownEmbeddedPaths(normalizePlanningInstructionHeading(b));
  return na === nb;
}

export function planningDocBodiesEquivalent(
  relativePath: string,
  local: string,
  remote: string,
): boolean {
  if (local === remote) return true;
  return planningMarkdownEquivalentForSeededInstructions(relativePath, local, remote);
}

export function isUnderPlanningUnsyncedPrefix(relativePath: string): boolean {
  const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return norm === PLANNING_CLOUD_UNSYNCED_PREFIX || norm.startsWith(`${PLANNING_CLOUD_UNSYNCED_PREFIX}/`);
}

export interface FirestoreHydrationWritePlan {
  /** Existing local content to preserve before overwriting with Firestore canonical. */
  backups: { relativePath: string; markdown: string }[];
  /** Canonical tree written from Firestore (relative paths exclude `_flux_unsynced/`). */
  writes: { relativePath: string; markdown: string }[];
}

/**
 * Build disk writes + backups given Firestore docs and current local file contents.
 * Only includes backups where local differs meaningfully from remote.
 */
export function buildFirestoreFirstHydrationPlan(input: {
  remoteByPath: Map<string, string>;
  localByPath: Map<string, string>;
}): FirestoreHydrationWritePlan {
  const backups: { relativePath: string; markdown: string }[] = [];
  const writes: { relativePath: string; markdown: string }[] = [];

  for (const [relativePath, remoteMarkdown] of input.remoteByPath) {
    if (isUnderPlanningUnsyncedPrefix(relativePath)) continue;
    const local = input.localByPath.get(relativePath);
    if (local !== undefined && !planningDocBodiesEquivalent(relativePath, local, remoteMarkdown)) {
      backups.push({ relativePath, markdown: local });
    }
    writes.push({ relativePath, markdown: remoteMarkdown });
  }

  return { backups, writes };
}

/** Paths that exist only locally (excluding unsynced prefix) — not deleted by hydration. */
export function localOnlyPlanningPaths(
  remotePaths: Set<string>,
  localPaths: Iterable<string>,
): string[] {
  const out: string[] = [];
  for (const p of localPaths) {
    if (isUnderPlanningUnsyncedPrefix(p)) continue;
    if (!remotePaths.has(p)) out.push(p);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
