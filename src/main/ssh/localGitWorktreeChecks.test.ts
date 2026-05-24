import { describe, expect, it } from 'vitest';
import { parseGitStatusPorcelain } from './localGitWorktreeChecks';

describe('parseGitStatusPorcelain', () => {
  it('detects staged, unstaged, and untracked changes', () => {
    const state = parseGitStatusPorcelain('M  file.ts\n M other.ts\n?? new.ts\n');
    expect(state.dirty).toBe(true);
    expect(state.hasStaged).toBe(true);
    expect(state.hasUnstaged).toBe(true);
    expect(state.hasUntracked).toBe(true);
  });

  it('returns clean for empty output', () => {
    const state = parseGitStatusPorcelain('');
    expect(state.dirty).toBe(false);
  });
});
