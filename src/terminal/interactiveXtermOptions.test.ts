import { describe, expect, it } from 'vitest';
import { interactiveXtermCompatibilityOptions } from './interactiveXtermOptions';

describe('interactiveXtermCompatibilityOptions', () => {
  it('enables proposed API and Kitty keyboard for Neovim / modifier parity with Superset', () => {
    expect(interactiveXtermCompatibilityOptions.allowProposedApi).toBe(true);
    expect(interactiveXtermCompatibilityOptions.macOptionIsMeta).toBe(false);
    expect(interactiveXtermCompatibilityOptions.vtExtensions).toEqual({
      kittyKeyboard: true,
    });
  });
});
