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

  it('cursor rule matches combined legacy phrases', () => {
    const r = rules.find((x) => x.id === 'cursor-trust');
    expect(r).toBeDefined();
    const screen =
      'Workspace Trust Required something Do you trust the contents of this directory end';
    expect(r!.matches(screen)).toBe(true);
    expect(r!.matches('Workspace Trust Required only')).toBe(false);
  });

  it('cursor menu rule matches TUI trust prompt from runtime logs', () => {
    const r = rules.find((x) => x.id === 'cursor-trust-menu');
    expect(r).toBeDefined();
    const screen = collapseLikeRuntimeLogScreen();
    expect(r!.matches(screen)).toBe(true);
    expect(r!.respondWith).toBe('\r');
    expect(r!.matches('Use arrow keys to navigate only')).toBe(false);
  });
});

function collapseLikeRuntimeLogScreen(): string {
  return [
    'Workspace Trust Required',
    'Use arrow keys to navigate, Enter to select, or press the key shown',
  ].join(' ');
}
