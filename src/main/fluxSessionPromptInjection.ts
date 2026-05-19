import type { OverseerBinding, PlanningSession, Session } from '../types';
import type { TerminalBackend } from './terminalBackend/TerminalBackend';
import type { OverseerBindingStore } from './overseerBindingStore';
import { pickSessionForTaskWorktree } from './openWorkspacePath';
import {
  describeSessionInputForLog,
  isSessionInputDebugEnabled,
  wrapAsXtermBracketedPaste,
} from './sessionInputDebug';

/** Errors when injecting into a bound overseer planning PTY. */
export type OverseerPromptInjectionErrorCode =
  | 'OVERSEER_BINDING_NOT_FOUND'
  | 'OVERSEER_BINDING_PROJECT_MISMATCH'
  | 'NO_PLANNING_SESSION'
  | 'PLANNING_SESSION_NOT_RUNNING';

export type OverseerPromptInjectionResult =
  | { ok: true; sessionId: string; planningSessionId: string }
  | { ok: false; code: OverseerPromptInjectionErrorCode; message: string };

/** Errors when injecting into a task agent PTY (aligned with PR agent IPC). */
export type TaskSessionPromptInjectionErrorCode =
  | 'NO_AGENT_SESSION'
  | 'AGENT_SESSION_NOT_RUNNING';

export type TaskSessionPromptInjectionResult =
  | { ok: true; sessionId: string }
  | { ok: false; code: TaskSessionPromptInjectionErrorCode; message: string };

export type InjectFluxPromptOptions = {
  /** Invoked after the submit `\r` is written (task sessions only). */
  onTaskSubmit?: (sessionId: string) => void;
  debug?: { taskId?: string };
};

/**
 * Bracketed paste + awaited submit for task or planning PTYs.
 * Paste and submit are separate awaited writes so multiline prompts submit reliably.
 */
export async function injectFluxBracketedPrompt(
  backend: TerminalBackend,
  target: 'task' | 'planning',
  sessionId: string,
  promptBody: string,
  options?: InjectFluxPromptOptions,
): Promise<void> {
  const pasteInput = wrapAsXtermBracketedPaste(promptBody);
  const submitInput = '\r';
  if (isSessionInputDebugEnabled()) {
    console.log('[session:input]', {
      target,
      sessionId,
      taskId: options?.debug?.taskId,
      codeUnits: pasteInput.length,
      repr: describeSessionInputForLog(pasteInput),
    });
    console.log('[session:input]', {
      target,
      sessionId,
      taskId: options?.debug?.taskId,
      codeUnits: submitInput.length,
      repr: describeSessionInputForLog(submitInput),
    });
  }
  if (target === 'task') {
    await backend.writeSessionAwait(sessionId, pasteInput);
    await backend.writeSessionAwait(sessionId, submitInput);
    options?.onTaskSubmit?.(sessionId);
    return;
  }
  await backend.writePlanningAwait(sessionId, pasteInput);
  await backend.writePlanningAwait(sessionId, submitInput);
}

export async function resolveRunningTaskSessionForPromptInjection(
  listSessions: () => Promise<Session[]>,
  taskId: string,
  repoId?: string,
): Promise<TaskSessionPromptInjectionResult & { session?: Session }> {
  const sessions = await listSessions();
  const session = pickSessionForTaskWorktree(sessions, taskId, repoId?.trim() || undefined);
  if (!session) {
    return {
      ok: false,
      code: 'NO_AGENT_SESSION',
      message: "Start this task's agent session first.",
    };
  }
  if (session.status !== 'running') {
    return {
      ok: false,
      code: 'AGENT_SESSION_NOT_RUNNING',
      message:
        "This task's agent session is not running. Start or resume the session, then try again.",
    };
  }
  return { ok: true, sessionId: session.id, session };
}

export async function injectPromptIntoTaskSession(
  backend: TerminalBackend,
  sessionId: string,
  promptBody: string,
  options?: InjectFluxPromptOptions,
): Promise<{ ok: true }> {
  await injectFluxBracketedPrompt(backend, 'task', sessionId, promptBody, options);
  return { ok: true };
}

export async function resolvePlanningSessionForInjection(
  listPlanning: () => Promise<PlanningSession[]>,
  planningSessionId: string,
): Promise<
  | { ok: true; session: PlanningSession }
  | { ok: false; code: 'NO_PLANNING_SESSION' | 'PLANNING_SESSION_NOT_RUNNING'; message: string }
> {
  const id = planningSessionId.trim();
  const sessions = await listPlanning();
  const session = sessions.find((s) => s.id === id) ?? null;
  if (!session) {
    return {
      ok: false,
      code: 'NO_PLANNING_SESSION',
      message:
        'No planning session with that id is active. Start or attach the overseer planning session, then try again.',
    };
  }
  if (session.status !== 'running') {
    return {
      ok: false,
      code: 'PLANNING_SESSION_NOT_RUNNING',
      message:
        'The planning session is not running. Start or resume the overseer session, then try again.',
    };
  }
  return { ok: true, session };
}

export async function injectPromptIntoPlanningSession(
  backend: TerminalBackend,
  planningSessionId: string,
  promptBody: string,
): Promise<{ ok: true }> {
  await injectFluxBracketedPrompt(backend, 'planning', planningSessionId, promptBody);
  return { ok: true };
}

export async function resolveOverseerPlanningSession(
  store: OverseerBindingStore,
  listPlanning: () => Promise<PlanningSession[]>,
  projectId: string,
  repoId: string,
  sourceBranch: string,
): Promise<
  | { ok: true; session: PlanningSession; binding: OverseerBinding }
  | { ok: false; code: OverseerPromptInjectionErrorCode; message: string }
> {
  const binding = await store.find(repoId, sourceBranch);
  if (!binding) {
    return {
      ok: false,
      code: 'OVERSEER_BINDING_NOT_FOUND',
      message: `No overseer registered for repo "${repoId.trim()}" and branch "${sourceBranch.trim()}". Run \`fluxx coordination register-overseer\` from the planning session first.`,
    };
  }
  if (binding.projectId !== projectId.trim()) {
    return {
      ok: false,
      code: 'OVERSEER_BINDING_PROJECT_MISMATCH',
      message:
        'The overseer binding belongs to a different project. Re-register the overseer for this project.',
    };
  }
  const planning = await resolvePlanningSessionForInjection(
    listPlanning,
    binding.planningSessionId,
  );
  if (!planning.ok) {
    return {
      ok: false,
      code: planning.code,
      message: planning.message,
    };
  }
  return { ok: true, session: planning.session, binding };
}

export async function injectPromptIntoBoundOverseerSession(
  backend: TerminalBackend,
  store: OverseerBindingStore,
  listPlanning: () => Promise<PlanningSession[]>,
  projectId: string,
  repoId: string,
  sourceBranch: string,
  promptBody: string,
): Promise<OverseerPromptInjectionResult> {
  const resolved = await resolveOverseerPlanningSession(
    store,
    listPlanning,
    projectId,
    repoId,
    sourceBranch,
  );
  if (!resolved.ok) {
    return resolved;
  }
  await injectPromptIntoPlanningSession(backend, resolved.session.id, promptBody);
  return {
    ok: true,
    sessionId: resolved.session.id,
    planningSessionId: resolved.session.id,
  };
}
