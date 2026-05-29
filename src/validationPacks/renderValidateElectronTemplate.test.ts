import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getValidationPackById } from './registry';
import { renderValidateElectronTemplate } from './renderValidateElectronTemplate';

describe('renderValidateElectronTemplate', () => {
  it('substitutes run dir, id, and project launch command', () => {
    const pack = getValidationPackById('electron-playwright');
    expect(pack).toBeTruthy();
    const runDir = '/tmp/fluxx-validation-runs/run-abc';
    const rendered = renderValidateElectronTemplate(pack!.validateElectronTemplate, {
      runId: 'run-abc',
      runDir,
      worktreeCwd: '/worktrees/task-1',
      projectConfig: {
        launchCommand: 'pnpm start:aux',
        ready: { type: 'selector', value: '[data-testid="app-shell"]' },
        cleanUserData: true,
      },
    });
    expect(rendered).not.toContain('{{RUN_ID}}');
    expect(rendered).toContain(JSON.stringify(runDir));
    expect(rendered).toContain(JSON.stringify('run-abc'));
    expect(rendered).toContain(JSON.stringify('/worktrees/task-1'));
    expect(rendered).toContain(JSON.stringify('pnpm start:aux'));
    expect(rendered).toContain('app-shell');
    expect(rendered).toContain('"type":"selector"');
    expect(rendered).toMatch(/^import /m);
    expect(rendered).toContain('const CLEAN_USER_DATA = true;');
  });

  it('uses null launch, ready, and cleanUserData when project config is empty', () => {
    const pack = getValidationPackById('electron-playwright');
    expect(pack).toBeTruthy();
    const rendered = renderValidateElectronTemplate(pack!.validateElectronTemplate, {
      runId: 'run-empty',
      runDir: '/tmp/run-empty',
      worktreeCwd: '/worktrees/task-1',
    });
    expect(rendered).toContain('const LAUNCH_COMMAND = null;');
    expect(rendered).toContain('const READY = null;');
    expect(rendered).toContain('const CLEAN_USER_DATA = null;');
  });
});
