import { loadValidationPacksProjectConfig } from './projectConfig';
import type { ElectronPlaywrightPackProjectConfig, ValidationPackId } from './types';

export type ResolveValidationPackConfigInput = {
  projectDir: string;
  packId: ValidationPackId;
};

/**
 * Loads saved per-project pack config. Returns `{}` when the file or pack entry is missing.
 */
export function resolveValidationPackConfig(
  input: ResolveValidationPackConfigInput,
): ElectronPlaywrightPackProjectConfig {
  return loadValidationPacksProjectConfig(input.projectDir, input.packId) ?? {};
}
