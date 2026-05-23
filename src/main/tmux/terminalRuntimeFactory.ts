import type { TerminalKind } from '../../types';
import { isAuxDevInstance } from '../auxDevInstance';
import { probeTmuxAvailability } from '../tmuxAvailability';
import {
  SessionRuntime,
  type SessionRuntimeCallbacks,
  type SessionRuntimeSpawnSpec,
} from '../../terminal-runtime/SessionRuntime';
import {
  TmuxTerminalRuntime,
  type TmuxTerminalRuntimeSpawnSpec,
} from '../../terminal-runtime/TmuxTerminalRuntime';

export interface TerminalRuntimeFactoryContext {
  kind: TerminalKind;
  terminalId: string;
  projectSlugSource: string;
  persistTerminalsWithTmux: boolean;
  tmuxSpawnLauncherPath: string;
}

export type AnyTerminalRuntime = SessionRuntime | TmuxTerminalRuntime;

export async function shouldUseTmuxRuntime(ctx: TerminalRuntimeFactoryContext): Promise<boolean> {
  if (!ctx.persistTerminalsWithTmux) return false;
  // Aux dev shares project dirs with has disk but must not attach to/kill primary tmux sessions.
  if (isAuxDevInstance()) return false;
  if (process.platform === 'win32') return false;
  const availability = await probeTmuxAvailability();
  return availability.available;
}

export async function createTerminalRuntime(
  ctx: TerminalRuntimeFactoryContext,
  spec: SessionRuntimeSpawnSpec,
  callbacks: SessionRuntimeCallbacks,
  opts: { replayCapBytes?: number } = {},
): Promise<{ runtime: AnyTerminalRuntime; tmuxSessionName?: string }> {
  const useTmux = await shouldUseTmuxRuntime(ctx);
  if (!useTmux) {
    return {
      runtime: new SessionRuntime(spec, callbacks, opts),
    };
  }

  const tmuxSpec: TmuxTerminalRuntimeSpawnSpec = {
    ...spec,
    kind: ctx.kind,
    terminalId: ctx.terminalId,
    projectSlugSource: ctx.projectSlugSource,
    launcherPath: ctx.tmuxSpawnLauncherPath,
  };
  const runtime = await TmuxTerminalRuntime.create(tmuxSpec, callbacks, opts);
  return { runtime, tmuxSessionName: runtime.tmuxSessionName };
}
