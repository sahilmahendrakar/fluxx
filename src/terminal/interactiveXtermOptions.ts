import type { ITerminalOptions } from '@xterm/xterm';

/**
 * Superset-aligned xterm options for interactive PTY tabs (agent + shell).
 * Keeps PTY `TERM_PROGRAM=kitty` honest: the renderer enables the Kitty keyboard
 * protocol so Neovim/modifier-aware TUIs get CSI `u` sequences instead of
 * ambiguous legacy encodings.
 *
 * @see https://github.com/xtermjs/xterm.js (vtExtensions.kittyKeyboard)
 */
export const interactiveXtermCompatibilityOptions: Pick<
  ITerminalOptions,
  'allowProposedApi' | 'macOptionIsMeta' | 'vtExtensions'
> = {
  allowProposedApi: true,
  macOptionIsMeta: false,
  vtExtensions: { kittyKeyboard: true },
};
