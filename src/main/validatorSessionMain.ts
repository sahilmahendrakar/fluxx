import path from 'node:path';
import type { LocalProject, Session, Task } from '../types';
import { expectedTaskFluxxWorkBranch } from '../taskBranch';
import {
  fluxAutomationPtyEnv,
  resolveFluxCliBinDir,
  writeFluxCliBridgeConfig,
} from './fluxAutomationBridge';
import { ensureProjectMcpConfig, materializeCursorMcpConfig } from './mcpConfig';
import type { TerminalBackend } from './terminalBackend/TerminalBackend';
import {
  cwdUnderTrustPromptAutorespondRoots,
  trustPromptAutorespondRootsForProject,
} from './trustPromptAutorespondRoots';
import { resolveValidatorWorktree, startValidatorSession } from './startValidatorSession';
import type { ValidationRunStore } from './ValidationRunStore';
import type { ValidationRun } from '../validationRuns/types';
import type { ActiveProjectKey } from '../types';

export type ValidatorSessionLauncherDeps = {
  validationRunStore: ValidationRunStore;
  terminalBackend: TerminalBackend;
  listTerminalSessions: () => Promise<Session[]>;
  getRecordProjectDir: () => string;
  getProject: () => LocalProject | null;
  getActiveProjectKey: () => ActiveProjectKey | null;
  getFluxAutomation: () => {
    server: { whenReady: () => Promise<void>; baseUrl: string } | null;
    token: string | null;
  };
};

export function createValidatorSessionLauncher(
  deps: ValidatorSessionLauncherDeps,
): (input: { task: Task; runId: string }) => Promise<
  | { ok: true; run: ValidationRun; sessionId: string }
  | { ok: false; error: string }
> {
  return async (input) => {
    const projectDir = deps.getRecordProjectDir()?.trim();
    if (!projectDir) {
      return { ok: false, error: 'No project directory open for validation runs' };
    }

    const project = deps.getProject();
    let projectMcpConfig: Awaited<ReturnType<typeof ensureProjectMcpConfig>>;
    try {
      projectMcpConfig = await ensureProjectMcpConfig(projectDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Could not load MCP config: ${message}` };
    }

    const result = await startValidatorSession(
      {
        validationRunStore: deps.validationRunStore,
        terminalBackend: deps.terminalBackend,
        listTerminalSessions: deps.listTerminalSessions,
        getProjectDir: deps.getRecordProjectDir,
        resolveWorktreePath: async (task, dir) =>
          resolveValidatorWorktree(
            task,
            dir,
            deps.listTerminalSessions,
            task.fluxxWorkBranch ?? expectedTaskFluxxWorkBranch(task),
          ),
        buildSpawnContext: async (worktreePath) => {
          const trustRoots = trustPromptAutorespondRootsForProject(projectDir);
          const trustAutorespond =
            project?.autoRespondToTrustPrompts === true &&
            cwdUnderTrustPromptAutorespondRoots(worktreePath, trustRoots);
          let ptyEnv: Record<string, string> | undefined;
          const activeKey = deps.getActiveProjectKey();
          const flux = deps.getFluxAutomation();
          if (flux.server && flux.token && activeKey) {
            await flux.server.whenReady();
            await writeFluxCliBridgeConfig(projectDir, {
              url: flux.server.baseUrl,
              token: flux.token,
              expectedActiveKey: activeKey,
            });
            ptyEnv = fluxAutomationPtyEnv({
              baseUrl: flux.server.baseUrl,
              token: flux.token,
              expectedActiveKey: activeKey,
              fluxCliBinDir: resolveFluxCliBinDir(),
            });
          }
          return {
            mcpConfigPath: projectMcpConfig.path,
            ...(ptyEnv ? { ptyEnv } : {}),
            ...(trustAutorespond
              ? { trustPromptAutorespond: true as const, trustPromptAutorespondRoots: trustRoots }
              : {}),
          };
        },
        materializeCursorMcp: async (worktreePath) => {
          await materializeCursorMcpConfig(worktreePath, projectMcpConfig.config);
        },
      },
      input,
    );

    if (!result.ok) {
      return { ok: false, error: result.message };
    }
    return { ok: true, run: result.run, sessionId: result.session.id };
  };
}

export function resolveValidatorSessionRunDir(
  projectDir: string,
  runId: string,
): string {
  return path.join(projectDir, 'validation-runs', runId);
}
