import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseValidationVerdictJson } from './verdict';

describe('parseValidationVerdictJson', () => {
  it('accepts the pack example verdict', () => {
    const raw = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'validation-packs/electron-playwright/examples/verdict.example.json',
      ),
      'utf8',
    );
    const result = parseValidationVerdictJson(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verdict.verdict).toBe('passed');
      expect(result.verdict.checks.length).toBeGreaterThan(0);
    }
  });

  it('rejects missing checks', () => {
    const result = parseValidationVerdictJson(
      JSON.stringify({ verdict: 'passed', summary: 'ok', checks: [] }),
    );
    expect(result.ok).toBe(false);
  });
});
