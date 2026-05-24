import { describe, expect, it } from 'vitest';
import { parseValidationPacksProjectFile } from './projectConfig';

describe('parseValidationPacksProjectFile', () => {
  it('parses electron-playwright launch and ready config', () => {
    const parsed = parseValidationPacksProjectFile(
      JSON.stringify({
        packs: {
          'electron-playwright': {
            launchCommand: 'pnpm start:aux',
            ready: { type: 'selector', value: '[data-testid="app-shell"]' },
          },
        },
      }),
    );
    expect(parsed?.packs?.['electron-playwright']?.launchCommand).toBe('pnpm start:aux');
    expect(parsed?.packs?.['electron-playwright']?.ready?.type).toBe('selector');
  });
});
