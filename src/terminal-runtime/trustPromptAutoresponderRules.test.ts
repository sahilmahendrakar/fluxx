import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTrustPromptAutoresponderRules } from './trustPromptAutoresponderRules';

describe('buildTrustPromptAutoresponderRules', () => {
  const roots = [path.resolve('/p/worktrees')];
  const rules = buildTrustPromptAutoresponderRules(roots);

  it('registers cwd gates on every rule', () => {
    for (const r of rules) {
      expect(typeof r.cwdAllowlist).toBe('function');
    }
  });

  it('claude rule matches trust phrase when cwd is allowlisted', () => {
    const r = rules.find((x) => x.id === 'claude-trust');
    expect(r).toBeDefined();
    const screen =
      'foo Is this a project you created or one you trust bar Is this a project you created or one you trust';
    expect(r!.cwdAllowlist('/p/worktrees/t1')).toBe(true);
    expect(r!.cwdAllowlist('/nope')).toBe(false);
    expect(r!.matches(screen)).toBe(true);
  });

  it('cursor rule matches combined phrases', () => {
    const r = rules.find((x) => x.id === 'cursor-trust');
    expect(r).toBeDefined();
    const screen =
      'Workspace Trust Required something Do you trust the contents of this directory end';
    expect(r!.matches(screen)).toBe(true);
    expect(r!.matches('Workspace Trust Required only')).toBe(false);
  });

  it('codex rule matches directory trust menu when cwd is allowlisted', () => {
    const r = rules.find((x) => x.id === 'codex-trust');
    expect(r).toBeDefined();
    const screen =
      'You are in /p/worktrees/t1 Do you trust the contents of this directory? 1. Yes, continue 2. No, quit Press enter to continue';
    expect(r!.agents).toEqual(['codex']);
    expect(r!.cwdAllowlist('/p/worktrees/t1')).toBe(true);
    expect(r!.cwdAllowlist('/nope')).toBe(false);
    expect(r!.matches(screen)).toBe(true);
    expect(r!.matches('Do you trust the contents of this directory only')).toBe(false);
    expect(r!.respondWith).toBe('\r');
  });

  it('preserves claude and cursor rules when codex rule is registered', () => {
    expect(rules.map((r) => r.id)).toEqual(['claude-trust', 'cursor-trust', 'codex-trust']);
  });
});
