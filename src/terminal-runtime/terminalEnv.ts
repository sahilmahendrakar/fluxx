/**
 * Curated environment variables for every PTY the main process spawns.
 *
 * PTYs ultimately host TUIs (claude-code, cursor agent, codex, plain shells)
 * that decide their rendering richness based on terminal env vars. In dev
 * the app inherits these from the launching terminal (`pnpm start` from
 * iTerm/Terminal.app), so things look fine by accident. In packaged GUI
 * launches Electron inherits launchd's bare env — no `TERM`, no
 * `COLORTERM`, etc. — and TUIs fall back to ANSI-16 colors and stripped
 * banners.
 *
 * This module supplies a deterministic recipe that does not depend on the
 * launching context. Modeled after Superset's
 * `packages/host-service/src/terminal/env.ts#buildV2TerminalEnv`.
 */

const UTF8_RE = /utf-?8/i;

/**
 * Pick the locale env value to use for the PTY. Prefers the inherited
 * `LC_ALL` / `LANG` if either is already a UTF-8 locale; otherwise falls
 * back to `en_US.UTF-8` to guarantee unicode glyphs in TUIs.
 */
export function normalizeUtf8Locale(
  baseEnv: NodeJS.ProcessEnv | Record<string, string>,
): string {
  const lcAll = baseEnv.LC_ALL;
  if (typeof lcAll === 'string' && UTF8_RE.test(lcAll)) return lcAll;
  const lang = baseEnv.LANG;
  if (typeof lang === 'string' && UTF8_RE.test(lang)) return lang;
  return 'en_US.UTF-8';
}

/**
 * Build the PTY env from a base env (caller's `spec.env` or `process.env`),
 * forcing the terminal-shape keys to deterministic values regardless of
 * what the daemon inherited.
 *
 * Forced overrides:
 * - `TERM=xterm-256color` — matches xterm.js capabilities; replaces the
 *   `xterm-color` (8-color) default that node-pty's `name` field would set.
 * - `COLORTERM=truecolor` — claude-code et al. gate 24-bit color on this.
 * - `LANG` — UTF-8 locale via {@link normalizeUtf8Locale}, so wide chars
 *   and box-drawing glyphs render instead of `?`.
 * - `TERM_PROGRAM=kitty` — claude-code and similar chat TUIs only parse
 *   kitty CSI-u sequences (e.g. Shift+Enter → `\x1b[13;2u`) when
 *   `TERM_PROGRAM ∈ {ghostty, kitty, iTerm.app, WezTerm, WarpTerminal}`.
 *   xterm.js already emits the right bytes; claiming kitty means they get
 *   parsed instead of submitted as plain Enter. Lifted verbatim from
 *   Superset; their comment on this is the canonical reference.
 * - `COLORFGBG=15;0` — Flux's window chrome is always dark, so hint white
 *   foreground on black background so TUIs that auto-pick palettes
 *   (vim, fzf) choose dark-mode variants.
 */
export function buildPtyEnv(
  baseEnv: NodeJS.ProcessEnv | Record<string, string>,
): NodeJS.ProcessEnv {
  // Copy so we never mutate the caller's env. Keeps `process.env` intact
  // for any other concurrent spawn.
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.LANG = normalizeUtf8Locale(baseEnv);
  env.TERM_PROGRAM = 'kitty';
  env.COLORFGBG = '15;0';
  return env;
}

/**
 * The terminfo entry name passed to node-pty's `name` option. node-pty
 * sets this as the child's `TERM` env. We pin it to match `buildPtyEnv`'s
 * `TERM=xterm-256color` so the two never disagree.
 */
export const PTY_TERM_NAME = 'xterm-256color';
