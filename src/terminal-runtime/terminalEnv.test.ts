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
    expect(env.TERM_PROGRAM).toBe('kitty');
    expect(env.COLORFGBG).toBe('15;0');
    expect(env.LANG).toBe('en_US.UTF-8');
  });

  it('overrides inherited TERM/COLORTERM/TERM_PROGRAM', () => {
    const env = buildPtyEnv({
      TERM: 'screen-256color',
      COLORTERM: '',
      TERM_PROGRAM: 'Apple_Terminal',
    });
    expect(env.TERM).toBe('xterm-256color');
    expect(env.COLORTERM).toBe('truecolor');
    expect(env.TERM_PROGRAM).toBe('kitty');
  });

  it('keeps base env values for non-terminal-shape keys', () => {
    const env = buildPtyEnv({ HOME: '/tmp/home', PATH: '/usr/bin', FLUX_DEBUG: '1' });
    expect(env.HOME).toBe('/tmp/home');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.FLUX_DEBUG).toBe('1');
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
