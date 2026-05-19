import { describe, expect, it } from 'vitest';
import { buildPtyEnv, normalizeUtf8Locale, PTY_TERM_NAME } from './terminalEnv';

describe('normalizeUtf8Locale', () => {
  it('prefers LC_ALL when it is a UTF-8 locale', () => {
    expect(normalizeUtf8Locale({ LC_ALL: 'en_GB.UTF-8', LANG: 'C' })).toBe('en_GB.UTF-8');
  });

  it('accepts utf8 (no dash) as well as UTF-8', () => {
    expect(normalizeUtf8Locale({ LC_ALL: 'en_US.utf8' })).toBe('en_US.utf8');
    expect(normalizeUtf8Locale({ LANG: 'de_DE.UTF8' })).toBe('de_DE.UTF8');
  });

  it('falls back to LANG when LC_ALL is unset or non-UTF8', () => {
    expect(normalizeUtf8Locale({ LANG: 'fr_FR.UTF-8' })).toBe('fr_FR.UTF-8');
    expect(normalizeUtf8Locale({ LC_ALL: 'C', LANG: 'ja_JP.UTF-8' })).toBe('ja_JP.UTF-8');
  });

  it('falls back to en_US.UTF-8 when neither is UTF-8', () => {
    expect(normalizeUtf8Locale({})).toBe('en_US.UTF-8');
    expect(normalizeUtf8Locale({ LC_ALL: 'C', LANG: 'C' })).toBe('en_US.UTF-8');
    expect(normalizeUtf8Locale({ LC_ALL: 'POSIX' })).toBe('en_US.UTF-8');
  });

  it('keeps C.UTF-8 (which is technically UTF-8)', () => {
    expect(normalizeUtf8Locale({ LC_ALL: 'C.UTF-8' })).toBe('C.UTF-8');
  });
});

describe('buildPtyEnv', () => {
  it('forces deterministic terminal-shape vars regardless of base env', () => {
    const env = buildPtyEnv({});
    expect(env.TERM).toBe('xterm-256color');
    expect(env.COLORTERM).toBe('truecolor');
    expect(env.COLORFGBG).toBe('15;0');
    expect(env.CLICOLOR).toBe('1');
    expect(env.FORCE_COLOR).toBe('3');
    expect(env.LANG).toBe('en_US.UTF-8');
  });

  it('does not set TERM_PROGRAM by default (safe for vim/neovim)', () => {
    const env = buildPtyEnv({});
    expect(env.TERM_PROGRAM).toBeUndefined();
  });

  it('does not set TERM_PROGRAM when base env has one and no override given', () => {
    const env = buildPtyEnv({ TERM_PROGRAM: 'Apple_Terminal' });
    // Inherited value is preserved when no explicit override is given.
    expect(env.TERM_PROGRAM).toBe('Apple_Terminal');
  });

  it('sets TERM_PROGRAM when opts.termProgram is provided (agent sessions)', () => {
    const env = buildPtyEnv({}, { termProgram: 'kitty' });
    expect(env.TERM_PROGRAM).toBe('kitty');
  });

  it('overrides inherited TERM_PROGRAM when opts.termProgram is provided', () => {
    const env = buildPtyEnv(
      { TERM_PROGRAM: 'Apple_Terminal' },
      { termProgram: 'kitty' },
    );
    expect(env.TERM_PROGRAM).toBe('kitty');
  });

  it('overrides inherited TERM/COLORTERM', () => {
    const env = buildPtyEnv({
      TERM: 'screen-256color',
      COLORTERM: '',
    });
    expect(env.TERM).toBe('xterm-256color');
    expect(env.COLORTERM).toBe('truecolor');
  });

  it('keeps base env values for non-terminal-shape keys', () => {
    const env = buildPtyEnv({ HOME: '/tmp/home', PATH: '/usr/bin', FLUX_DEBUG: '1' });
    expect(env.HOME).toBe('/tmp/home');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.FLUX_DEBUG).toBe('1');
  });

  it('removes inherited no-color flags that flatten agent TUIs', () => {
    const env = buildPtyEnv({
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      CLICOLOR: '0',
    });
    expect(env.NO_COLOR).toBeUndefined();
    expect(env.FORCE_COLOR).toBe('3');
    expect(env.CLICOLOR).toBe('1');
  });

  it('does not mutate the input env', () => {
    const baseEnv: Record<string, string> = { LANG: 'C', TERM: 'dumb' };
    buildPtyEnv(baseEnv);
    expect(baseEnv.LANG).toBe('C');
    expect(baseEnv.TERM).toBe('dumb');
  });

  it('PTY_TERM_NAME matches the TERM env value', () => {
    const env = buildPtyEnv({});
    expect(env.TERM).toBe(PTY_TERM_NAME);
  });
});
