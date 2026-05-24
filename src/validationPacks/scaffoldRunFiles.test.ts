import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scaffoldValidationRunFiles } from './scaffoldRunFiles';

describe('scaffoldValidationRunFiles', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  it('writes instructions and validate-electron.mjs under the run directory', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-pack-scaffold-'));
    const runId = 'run-test-1';
    const runDir = path.join(tmp, 'validation-runs', runId);
    await fs.mkdir(runDir, { recursive: true });

    const { instructionsMarkdown } = await scaffoldValidationRunFiles({
      packId: 'electron-playwright',
      runId,
      runDir,
      projectDir: tmp,
    });

    expect(instructionsMarkdown).toContain('Electron Playwright');
    const instructions = await fs.readFile(path.join(runDir, 'instructions.md'), 'utf8');
    expect(instructions).toBe(instructionsMarkdown);
    const script = await fs.readFile(path.join(runDir, 'validate-electron.mjs'), 'utf8');
    expect(script).toContain(runId);
    expect(script).toContain(runDir);
    expect(script).not.toContain('{{RUN_ID}}');
  });
});
