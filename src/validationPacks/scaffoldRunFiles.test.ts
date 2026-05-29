import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveValidationPacksProjectConfig } from './projectConfig';
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

  it('embeds saved project config in instructions and template', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-pack-scaffold-'));
    saveValidationPacksProjectConfig(tmp, 'electron-playwright', {
      launchCommand: 'pnpm start:aux',
      ready: { type: 'selector', value: '[data-testid="app-shell"]' },
      cleanUserData: true,
    });
    const runId = 'run-saved-config';
    const runDir = path.join(tmp, 'validation-runs', runId);
    await fs.mkdir(runDir, { recursive: true });

    const { instructionsMarkdown } = await scaffoldValidationRunFiles({
      packId: 'electron-playwright',
      runId,
      runDir,
      projectDir: tmp,
    });

    expect(instructionsMarkdown).toContain('pnpm start:aux');
    expect(instructionsMarkdown).toContain('app-shell');
    const script = await fs.readFile(path.join(runDir, 'validate-electron.mjs'), 'utf8');
    expect(script).toContain(JSON.stringify('pnpm start:aux'));
    expect(script).toContain('CLEAN_USER_DATA');
    expect(script).toContain('true');
  });

  it('scaffolds with null launch command when config is empty', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-pack-scaffold-'));
    const runId = 'run-empty-config';
    const runDir = path.join(tmp, 'validation-runs', runId);
    await fs.mkdir(runDir, { recursive: true });

    await scaffoldValidationRunFiles({
      packId: 'electron-playwright',
      runId,
      runDir,
      projectDir: tmp,
    });

    const instructions = await fs.readFile(path.join(runDir, 'instructions.md'), 'utf8');
    expect(instructions).toContain('No project `validation-packs.json` overrides');
    const script = await fs.readFile(path.join(runDir, 'validate-electron.mjs'), 'utf8');
    expect(script).toContain('const LAUNCH_COMMAND = null;');
    expect(script).toContain('const READY = null;');
    expect(script).toContain('const CLEAN_USER_DATA = null;');
  });
});
