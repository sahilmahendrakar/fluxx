import type { ElectronPlaywrightPackProjectConfig, ValidationPackScaffoldContext } from './types';

function jsonLiteral(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Renders `validate-electron.mjs.tpl` with run-local paths and optional project config.
 */
export function renderValidateElectronTemplate(
  template: string,
  ctx: ValidationPackScaffoldContext,
): string {
  const project = ctx.projectConfig ?? {};
  const worktreeCwd = ctx.worktreeCwd ?? project.worktreeCwd ?? '.';
  const ready = project.ready ?? null;

  return template
    .replaceAll('{{RUN_ID}}', ctx.runId)
    .replaceAll('{{RUN_DIR_JSON}}', jsonLiteral(ctx.runDir))
    .replaceAll('{{RUN_ID_JSON}}', jsonLiteral(ctx.runId))
    .replaceAll('{{WORKTREE_CWD_JSON}}', jsonLiteral(worktreeCwd))
    .replaceAll('{{LAUNCH_COMMAND_JSON}}', jsonLiteral(project.launchCommand ?? null))
    .replaceAll('{{READY_JSON}}', jsonLiteral(ready))
    .replaceAll('{{CLEAN_USER_DATA_JSON}}', jsonLiteral(project.cleanUserData ?? null));
}

export function defaultElectronPlaywrightProjectConfig(): ElectronPlaywrightPackProjectConfig {
  return {
    launchCommand: 'pnpm start:aux',
    worktreeCwd: '.',
    ready: { type: 'timeout', ms: 15_000 },
    cleanUserData: true,
    artifactPolicy: {
      screenshots: 'required',
      trace: 'on-failure',
      consoleLogs: 'always',
    },
  };
}
