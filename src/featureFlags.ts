/**
 * Lightweight feature-flag helpers shared by main / renderer / daemon code.
 *
 * Flags are read from `process.env` at call time (no caching) so a dev can
 * toggle them between Electron restarts without rebuilding. Renderer code
 * reads the same env via Vite's `import.meta.env` mirrored onto
 * `process.env` (see `vite.renderer.config.ts`); when in doubt, prefer
 * passing the resolved boolean from main → renderer over reading directly
 * from inside React.
 *
 * Contract for new flags: name them after the user-facing feature
 * (kebab-case), keep the env var prefixed with `FLUX_FF_` and SCREAMING_SNAKE,
 * and gate **only** newly visible behavior. Off must preserve current UX.
 */
export const FEATURE_FLAGS = {
  /**
   * Multi-repo project support — see `RepoConfig.id` / `Task.repoId` /
   * `Session.repoId`. With the flag off, single-repo behavior is unchanged
   * even though the data model carries repo identity for safe migrations.
   */
  multiRepo2: 'multi-repo2',
} as const;

export type FeatureFlagName = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

const ENV_VAR: Record<FeatureFlagName, string> = {
  'multi-repo2': 'FLUX_FF_MULTI_REPO2',
};

function readEnvBool(varName: string): boolean {
  const v = ((typeof process !== 'undefined' ? process.env?.[varName] : undefined) ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Generic check for any registered feature flag. */
export function isFeatureFlagEnabled(flag: FeatureFlagName): boolean {
  return readEnvBool(ENV_VAR[flag]);
}

/**
 * `multi-repo2`: gates newly visible multi-repo UX. With the flag off,
 * existing single-repo runtime should behave unchanged. Helpers and the
 * underlying data model still ship — they’re needed for legacy migrations
 * — but only the “primary” repo is exercised at runtime.
 */
export function isMultiRepo2Enabled(): boolean {
  return isFeatureFlagEnabled(FEATURE_FLAGS.multiRepo2);
}
