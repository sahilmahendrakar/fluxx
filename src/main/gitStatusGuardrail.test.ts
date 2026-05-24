import { describe, expect, it } from 'vitest';
import { compareGitStatusPorcelain } from './gitStatusGuardrail';

describe('compareGitStatusPorcelain', () => {
  it('detects no drift when porcelain is unchanged', () => {
    const pre = { porcelain: ' M src/a.ts\n?? tmp.txt', capturedAt: 't1' };
    const post = { porcelain: ' M src/a.ts\n?? tmp.txt', capturedAt: 't2' };
    expect(compareGitStatusPorcelain(pre, post)).toEqual({
      pre,
      post,
      driftDetected: false,
    });
  });

  it('detects drift when new changes appear during validation', () => {
    const pre = { porcelain: ' M src/a.ts', capturedAt: 't1' };
    const post = { porcelain: ' M src/a.ts\n M src/b.ts', capturedAt: 't2' };
    const result = compareGitStatusPorcelain(pre, post);
    expect(result.driftDetected).toBe(true);
    expect(result.driftSummary).toMatch(/changed during validation/i);
    expect(result.driftSummary).toMatch(/src\/b.ts/);
  });
});
