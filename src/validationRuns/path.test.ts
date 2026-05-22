import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeValidationRunRelativePath,
  resolvePathUnderValidationRunDir,
  validationRunDir,
} from './path';

describe('validationRuns/path', () => {
  it('normalizeValidationRunRelativePath rejects traversal', () => {
    expect(normalizeValidationRunRelativePath('../etc/passwd')).toBeNull();
    expect(normalizeValidationRunRelativePath('artifacts/../verdict.json')).toBeNull();
    expect(normalizeValidationRunRelativePath('')).toBeNull();
    expect(normalizeValidationRunRelativePath('artifacts/screenshots/a.png')).toBe(
      'artifacts/screenshots/a.png',
    );
  });

  it('resolvePathUnderValidationRunDir stays inside run root', () => {
    const runDir = path.join('/tmp', 'proj', 'validation-runs', 'run-1');
    const inside = resolvePathUnderValidationRunDir(
      runDir,
      'artifacts/logs/console.txt',
    );
    expect(inside).toBe(path.join(runDir, 'artifacts/logs/console.txt'));
    expect(
      resolvePathUnderValidationRunDir(runDir, '../../outside.txt'),
    ).toBeNull();
  });

  it('validationRunDir uses project-scoped validation-runs segment', () => {
    expect(validationRunDir('/fluxx/projects/p1', 'abc')).toBe(
      '/fluxx/projects/p1/validation-runs/abc',
    );
  });
});
