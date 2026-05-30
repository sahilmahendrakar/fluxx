import type { ElectronPlaywrightPackProjectConfig } from './types';

/**
 * Suggested values for the project settings validation form (Flux dogfood).
 * Not written to `validation-packs.json` until the user saves.
 */
export const ELECTRON_PLAYWRIGHT_VALIDATION_CONFIG_UI_PLACEHOLDERS = {
  launchCommand: 'pnpm start:aux',
  ready: {
    type: 'selector',
    value: "[data-testid='app-shell']",
    timeoutMs: 120_000,
  },
  cleanUserData: true,
} as const satisfies Pick<
  ElectronPlaywrightPackProjectConfig,
  'launchCommand' | 'ready' | 'cleanUserData'
>;
