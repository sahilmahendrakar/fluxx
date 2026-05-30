import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutList, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  TerminalAttachLoading,
  TerminalEmptyState,
  TerminalInlineLoading,
  TerminalStatusBanner,
  TerminalTrustNotice,
  TerminalWorkspaceTab,
  terminalToolbarClass,
  terminalWorkspaceShellClass,
  workspaceToolbarActionButtonClass,
  workspaceToolbarActionButtonDisabledClass,
} from '@/components/terminal/TerminalChrome';
import type { Agent, Session, Shell, ShellPlacement, Task } from '../types';
import TaskDetailPanel, { type TaskDetailPanelProps } from './TaskDetailPanel';
import { GithubPrIconButton } from './GithubPrIconButton';
import {
  taskWorkspaceShouldShowValidationTab,
  validationRunIsActive,
} from '../validationRuns/display';
import { validateButtonClassNameForStatus } from '../validationRuns/validateButtonClassNames';
import { evaluateValidateActionEligibility } from '../validationRuns/validateTaskAction';
import { useTaskValidationRuns } from '../validationRuns/useTaskValidationRuns';
import {
  getSessionAttachShared,
  getShellAttachShared,
  invalidateSessionAttachCache,
  invalidateShellAttachCache,
} from '../terminal/warmAttach';
import { isTaskBlocked } from '../taskDependencies';
import {
  OWNER_TERMINAL_VIEW_POLICY,
  terminalShouldAutoFit,
} from '../terminal/terminalGeometryPolicy';
import { useTerminalPtyStream } from '../terminal/useTerminalPtyStream';
import { useTrustAutorespondNotice } from '../hooks/useTrustAutorespondNotice';
import Terminal, { type TerminalHandle } from './Terminal';
import { OpenInWorkspaceButton } from './OpenInWorkspaceButton';
import { SessionShellAddMenu } from './SessionShellAddMenu';
import {
  remoteLifecycleStatusDetail,
  remoteLifecycleStatusHeading,
} from './remoteSessionLifecycleUi';
import {
  remoteSshSyncFailureDetail,
  remoteSshSyncSuccessDetail,
} from './remoteSshSyncUi';

export { invalidateSessionAttachCache, invalidateShellAttachCache };

function shellTabLabel(shell: Shell, shells: Shell[]): string {
  const localShells = shells.filter((s) => s.shellPlacement === 'local');
  const remoteShells = shells.filter((s) => s.shellPlacement !== 'local');
  if (shell.shellPlacement === 'local') {
    const idx = localShells.findIndex((s) => s.id === shell.id);
    return localShells.length > 1 ? `Local ${idx + 1}` : 'Local';
  }
  const idx = remoteShells.findIndex((s) => s.id === shell.id);
  return remoteShells.length > 1 ? `SSH ${idx + 1}` : 'SSH';
}

async function refreshSshLocalWorktreePath(sessionId: string): Promise<string | null> {
  try {
    const result = await window.electronAPI.sessions.getSshLocalWorktree(sessionId);
    return result.path?.trim() || null;
  } catch {
    return null;
  }
}

function taskAgentSupportsCliResume(agent: Agent | null): boolean {
  return agent === 'cursor' || agent === 'claude-code' || agent === 'codex';
}

function BotIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={13}
      height={13}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="8" cy="1.75" r="0.75" fill="currentColor" />
      <path d="M8 2.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="2.75" y="4.25" width="10.5" height="8" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="6" cy="8" r="0.9" fill="currentColor" />
      <circle cx="10" cy="8" r="0.9" fill="currentColor" />
      <path d="M6.5 10.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2.75 7.5H1.75M14.25 7.5H13.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export type AgentSessionLifecycleProps = {
  projectTasks: Task[];
  requesterUid?: string | null;
};

interface SessionTerminalViewProps {
  session: Session;
  visible?: boolean;
  /** Board task for this workspace; used for Mark as done. */
  task?: Task | null;
  /**
   * When the agent PTY has stopped, enables Resume / New session in the Agent pane
   * (same IPC as the task detail panel).
   */
  agentSessionLifecycle?: AgentSessionLifecycleProps;
  /** After a successful `sessions.start` from the Agent tab (Resume / New session). */
  onAgentSessionStartSuccess?: (taskId: string) => void;
  onMarkAsDone?: () => void;
  /** Dependency blockers not finished — Mark as done stays visible but disabled. */
  markAsDoneBlocked?: boolean;
  /** Done task with workspace not yet cleaned — same flow as board broom. */
  onRequestCleanupTask?: () => void;
  cleanupLoading?: boolean;
  /** Open linked PR or start create flow (same IPC as board `TaskCard`). */
  onTaskPrClick?: (taskId: string) => void;
  /** True while create PR is in flight for this session’s task. */
  prLoading?: boolean;
  prAgentAwaiting?: boolean;
  /**
   * Same callbacks/data as board `TaskDetailPanel` (except `task` and `layout`, which are set here).
   * When omitted or `task` is null, the Details pane tab is hidden.
   */
  taskDetailPanel?: Omit<TaskDetailPanelProps, 'task' | 'layout'>;
}

type PaneId = 'details' | 'agent' | 'validation' | `shell:${string}`;

// We stack every pane at inset-0 and flip `visibility` instead of `display`
// so the xterm container keeps the same size across pane switches. Reflowing
// the container (as display:none would) wipes the rendered buffer, which
// reads as "history disappeared" when the user flips tabs and back.
function paneVisibilityStyle(visible: boolean): React.CSSProperties {
  return {
    visibility: visible ? 'visible' : 'hidden',
    pointerEvents: visible ? 'auto' : 'none',
    zIndex: visible ? 1 : 0,
  };
}

function AgentPane({
  session,
  visible,
  task,
  agentSessionLifecycle,
  onAgentSessionStartSuccess,
}: {
  session: Session;
  visible: boolean;
  task?: Task | null;
  agentSessionLifecycle?: AgentSessionLifecycleProps;
  onAgentSessionStartSuccess?: (taskId: string) => void;
}) {
  const terminalRef = useRef<TerminalHandle | null>(null);
  const running = session.status === 'running';
  const id = session.id;
  const [attachReady, setAttachReady] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [remoteRetryLoading, setRemoteRetryLoading] = useState(false);

  const remoteInterrupted =
    session.status === 'interrupted' && Boolean(session.remoteLifecycleStatus);

  useEffect(() => {
    setAttachReady(false);
  }, [session.id]);

  useEffect(() => {
    if (running) {
      setRestartError(null);
      setRestartLoading(false);
    }
  }, [running]);

  useTerminalPtyStream({
    terminalRef,
    id,
    enabled: running,
    viewPolicy: OWNER_TERMINAL_VIEW_POLICY,
    getAttach: () =>
      getSessionAttachShared(id, async () => {
        try {
          return await window.electronAPI.sessions.attach(id);
        } catch (err) {
          console.error('[AgentPane] attach failed', err);
          return null;
        }
      }),
    onStreamData: (sid, cb) => window.electronAPI.sessions.onData(sid, cb),
    onAttachComplete: () => setAttachReady(true),
  });

  const handleData = (data: string) => {
    if (running) window.electronAPI.sessions.write(session.id, data);
  };
  const handleResize = (cols: number, rows: number) => {
    if (running) window.electronAPI.sessions.resize(session.id, cols, rows);
  };

  const blocked = Boolean(
    task &&
      agentSessionLifecycle &&
      isTaskBlocked(task, agentSessionLifecycle.projectTasks),
  );
  const showRestartControls =
    !running &&
    !remoteInterrupted &&
    task &&
    agentSessionLifecycle &&
    taskAgentSupportsCliResume(task.agent);

  const handleRemoteRetry = async () => {
    setRemoteRetryLoading(true);
    setRestartError(null);
    try {
      await window.electronAPI.sessions.reconcileRemote();
      onAgentSessionStartSuccess?.(session.taskId);
    } catch {
      setRestartError('Could not reconnect to the remote session.');
    } finally {
      setRemoteRetryLoading(false);
    }
  };

  const handleAgentRestart = async (resume: boolean) => {
    if (!task || !agentSessionLifecycle) return;
    if (isTaskBlocked(task, agentSessionLifecycle.projectTasks)) {
      setRestartError('Finish blocking tasks before starting a session.');
      return;
    }
    setRestartLoading(true);
    setRestartError(null);
    try {
      const result = await window.electronAPI.sessions.start(
        task,
        agentSessionLifecycle.projectTasks,
        agentSessionLifecycle.requesterUid ?? undefined,
        resume ? { resume: true } : undefined,
      );
      if (result && typeof result === 'object' && 'error' in result) {
        setRestartError(result.message ?? result.error);
        return;
      }
      onAgentSessionStartSuccess?.(task.id);
    } catch {
      setRestartError('Failed to start session');
    } finally {
      setRestartLoading(false);
    }
  };

  return (
    <div
      aria-hidden={!visible}
      className="absolute inset-0 p-3"
      style={paneVisibilityStyle(visible)}
    >
      {running ? (
        <div className="relative h-full min-h-0">
          {!attachReady ? <TerminalAttachLoading label="Starting…" /> : null}
          <Terminal
            ref={terminalRef}
            sessionId={session.id}
            onData={handleData}
            onResize={visible && running ? handleResize : undefined}
            visible={visible}
            autoFit={terminalShouldAutoFit(OWNER_TERMINAL_VIEW_POLICY)}
            hideCursor
          />
        </div>
      ) : remoteInterrupted && session.remoteLifecycleStatus ? (
        <TerminalEmptyState
          title={remoteLifecycleStatusHeading(session.remoteLifecycleStatus)}
          detail={remoteLifecycleStatusDetail(session.remoteLifecycleStatus, session)}
        >
          {session.remoteLifecycleStatus === 'device-unreachable' ||
          session.remoteLifecycleStatus === 'helper-mismatch' ? (
            <Button
              type="button"
              size="sm"
              disabled={remoteRetryLoading}
              onClick={() => void handleRemoteRetry()}
              className="bg-status-success text-status-success-foreground hover:bg-status-success/90"
            >
              {remoteRetryLoading ? 'Retrying…' : 'Retry connection'}
            </Button>
          ) : null}
          {restartError ? (
            <p className="max-w-sm text-xs leading-snug text-destructive" role="alert">
              {restartError}
            </p>
          ) : null}
        </TerminalEmptyState>
      ) : showRestartControls ? (
        <TerminalEmptyState title="This session is no longer running.">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={restartLoading || blocked}
              variant={restartError ? 'destructive' : 'default'}
              title={
                blocked
                  ? 'Blocked by incomplete dependencies'
                  : 'Continue the CLI session from disk (--resume)'
              }
              onClick={() => void handleAgentRestart(true)}
              className={
                restartError
                  ? undefined
                  : cn(
                      !blocked &&
                        'bg-status-success text-status-success-foreground hover:bg-status-success/90',
                      blocked && 'bg-status-terminal-foreground/10 text-status-terminal-foreground/45',
                    )
              }
            >
              {blocked ? 'Blocked' : restartError ? 'Retry' : 'Resume'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={restartLoading || blocked}
              title={
                blocked
                  ? 'Blocked by incomplete dependencies'
                  : 'Start a new agent session with the full task prompt'
              }
              onClick={() => void handleAgentRestart(false)}
              className="border-status-terminal-foreground/15 bg-status-terminal-foreground/5 text-status-terminal-foreground hover:bg-status-terminal-foreground/10"
            >
              {blocked ? 'Blocked' : 'New session'}
            </Button>
          </div>
          {restartError && !blocked ? (
            <p className="max-w-sm text-xs leading-snug text-destructive" role="alert">
              {restartError}
            </p>
          ) : null}
        </TerminalEmptyState>
      ) : (
        <TerminalEmptyState title="This session is no longer running." />
      )}
    </div>
  );
}

function ValidationPane({
  session,
  visible,
  runPending,
  awaitingPty,
}: {
  session: Session | null;
  visible: boolean;
  /** Queued run — validator launch has not returned a session id yet. */
  runPending: boolean;
  /** Running run with session id, but PTY row not visible yet (or ended). */
  awaitingPty: boolean;
}) {
  const terminalRef = useRef<TerminalHandle | null>(null);
  const running = session?.status === 'running';
  const id = session?.id ?? '';
  const trustAutorespondNote = useTrustAutorespondNotice('session', id || null, running);
  const [attachReady, setAttachReady] = useState(false);

  useEffect(() => {
    setAttachReady(false);
  }, [session?.id]);

  useTerminalPtyStream({
    terminalRef,
    id,
    enabled: running && Boolean(id),
    viewPolicy: OWNER_TERMINAL_VIEW_POLICY,
    getAttach: () =>
      getSessionAttachShared(id, async () => {
        try {
          return await window.electronAPI.sessions.attach(id);
        } catch (err) {
          console.error('[ValidationPane] attach failed', err);
          return null;
        }
      }),
    onStreamData: (sid, cb) => window.electronAPI.sessions.onData(sid, cb),
    onAttachComplete: () => setAttachReady(true),
  });

  const handleData = (data: string) => {
    if (running && session) window.electronAPI.sessions.write(session.id, data);
  };
  const handleResize = (cols: number, rows: number) => {
    if (running && session) window.electronAPI.sessions.resize(session.id, cols, rows);
  };

  return (
    <div
      aria-hidden={!visible}
      className="absolute inset-0 p-3"
      style={paneVisibilityStyle(visible)}
    >
      {runPending && !session ? (
        <TerminalInlineLoading label="Starting validator…" />
      ) : awaitingPty && !session ? (
        <TerminalInlineLoading label="Connecting to validator…" />
      ) : running && session ? (
        <div className="relative h-full min-h-0">
          {!attachReady ? <TerminalAttachLoading label="Connecting…" /> : null}
          {trustAutorespondNote ? (
            <TerminalTrustNotice>{trustAutorespondNote}</TerminalTrustNotice>
          ) : null}
          <Terminal
            ref={terminalRef}
            sessionId={session.id}
            onData={handleData}
            onResize={visible && running ? handleResize : undefined}
            visible={visible}
            autoFit={terminalShouldAutoFit(OWNER_TERMINAL_VIEW_POLICY)}
            hideCursor
          />
        </div>
      ) : session ? (
        <TerminalEmptyState
          title="Validator session ended."
          detail="Check the Details tab for validation status and artifacts."
        />
      ) : (
        <TerminalEmptyState title="No validator session available." />
      )}
    </div>
  );
}

function ShellPane({ shell, visible }: { shell: Shell; visible: boolean }) {
  const terminalRef = useRef<TerminalHandle | null>(null);
  const running = shell.status === 'running';
  const id = shell.id;

  useTerminalPtyStream({
    terminalRef,
    id,
    enabled: running,
    viewPolicy: OWNER_TERMINAL_VIEW_POLICY,
    getAttach: () =>
      getShellAttachShared(id, async () => {
        try {
          return await window.electronAPI.shells.attach(id);
        } catch (err) {
          console.error('[ShellPane] attach failed', err);
          return null;
        }
      }),
    onStreamData: (sid, cb) => window.electronAPI.shells.onData(sid, cb),
  });

  const handleData = (data: string) => {
    if (running) window.electronAPI.shells.write(shell.id, data);
  };
  const handleResize = (cols: number, rows: number) => {
    if (running) window.electronAPI.shells.resize(shell.id, cols, rows);
  };

  return (
    <div
      aria-hidden={!visible}
      className="absolute inset-0 p-3"
      style={paneVisibilityStyle(visible)}
    >
      {running ? (
        <Terminal
          ref={terminalRef}
          sessionId={shell.id}
          onData={handleData}
          onResize={visible && running ? handleResize : undefined}
          visible={visible}
          autoFit={terminalShouldAutoFit(OWNER_TERMINAL_VIEW_POLICY)}
        />
      ) : (
        <TerminalEmptyState title="Shell exited." />
      )}
    </div>
  );
}

export function SessionTerminalView({
  session,
  visible = true,
  task = null,
  agentSessionLifecycle,
  onAgentSessionStartSuccess,
  onMarkAsDone,
  markAsDoneBlocked = false,
  onRequestCleanupTask,
  cleanupLoading = false,
  onTaskPrClick,
  prLoading = false,
  prAgentAwaiting = false,
  taskDetailPanel,
}: SessionTerminalViewProps) {
  const [shells, setShells] = useState<Shell[]>([]);
  const [activePane, setActivePane] = useState<PaneId>('agent');
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncIsError, setSyncIsError] = useState(false);
  const [localWorktreePath, setLocalWorktreePath] = useState<string | null>(null);
  const running = session.status === 'running';
  const isRemoteSshSession = session.deviceKind === 'ssh';
  const localWorktreeAvailable = Boolean(localWorktreePath?.trim());
  const showMarkAsDone = task != null && task.status !== 'done';
  const markDoneDisabled = showMarkAsDone && (markAsDoneBlocked || !onMarkAsDone);
  const showCleanUp =
    task != null && task.status === 'done' && !task.workspaceCleanedAt && Boolean(onRequestCleanupTask);
  const cleanUpDisabled = showCleanUp && (cleanupLoading || !onRequestCleanupTask);
  const showDetailsTab = Boolean(task && taskDetailPanel);
  const { latestRun, refresh: refreshValidationRuns } = useTaskValidationRuns(task?.id);
  const [validatorSession, setValidatorSession] = useState<Session | null>(null);
  const validationAutoSwitchRunRef = useRef<string | null>(null);

  useEffect(() => {
    validationAutoSwitchRunRef.current = null;
  }, [task?.id]);

  useEffect(() => {
    if (task?.status !== 'validation') return;
    refreshValidationRuns();
  }, [task?.id, task?.status, refreshValidationRuns]);

  const showValidationTab = taskWorkspaceShouldShowValidationTab({
    latestRun,
    validatorSession,
  });
  const validationRunPending = Boolean(
    task &&
      latestRun?.status === 'queued' &&
      !latestRun.validatorSessionId?.trim() &&
      !validatorSession,
  );
  const validationRunAwaitingPty = Boolean(
    task &&
      latestRun?.status === 'running' &&
      latestRun.validatorSessionId?.trim() &&
      !validatorSession,
  );

  useEffect(() => {
    if (!task?.id) {
      setValidatorSession(null);
      return;
    }
    const sessionId = latestRun?.validatorSessionId?.trim();
    if (!sessionId) {
      setValidatorSession(null);
      return;
    }
    let cancelled = false;
    const syncValidatorSession = () => {
      void window.electronAPI.sessions.getAll().then((all) => {
        if (cancelled) return;
        setValidatorSession(all.find((s) => s.id === sessionId) ?? null);
      });
    };
    syncValidatorSession();
    const unsubExit = window.electronAPI.sessions.onExit((exited) => {
      if (exited.id === sessionId) {
        setValidatorSession(exited);
        refreshValidationRuns();
      }
    });
    const unsubValidation = window.electronAPI.validationRuns.onChanged(() => {
      refreshValidationRuns();
    });
    return () => {
      cancelled = true;
      unsubExit();
      unsubValidation();
    };
  }, [task?.id, latestRun?.id, latestRun?.validatorSessionId, refreshValidationRuns]);

  useEffect(() => {
    if (!task?.id || !latestRun || !validationRunIsActive(latestRun.status)) return;
    if (validatorSession) return;
    const timer = window.setInterval(() => refreshValidationRuns(), 2000);
    return () => window.clearInterval(timer);
  }, [
    task?.id,
    latestRun?.id,
    latestRun?.status,
    latestRun?.validatorSessionId,
    validatorSession,
    refreshValidationRuns,
  ]);

  useEffect(() => {
    if (activePane === 'details' && !showDetailsTab) {
      setActivePane('agent');
    }
  }, [activePane, showDetailsTab]);

  useEffect(() => {
    if (!isRemoteSshSession) {
      setLocalWorktreePath(null);
      return;
    }
    let cancelled = false;
    void refreshSshLocalWorktreePath(session.id).then((path) => {
      if (!cancelled) setLocalWorktreePath(path);
    });
    return () => {
      cancelled = true;
    };
  }, [isRemoteSshSession, session.id, task?.fluxxWorkBranch, task?.repoId]);

  useEffect(() => {
    if (activePane === 'validation' && !showValidationTab) {
      setActivePane('agent');
    }
  }, [activePane, showValidationTab]);

  useEffect(() => {
    if (!showValidationTab || !latestRun?.id) return;
    if (!validationRunIsActive(latestRun.status)) return;
    if (validationAutoSwitchRunRef.current === latestRun.id) return;
    validationAutoSwitchRunRef.current = latestRun.id;
    setActivePane('validation');
  }, [showValidationTab, latestRun?.id, latestRun?.status]);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.shells.list(session.id).then((list) => {
      if (!cancelled) setShells(list);
    });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  useEffect(() => {
    const unsub = window.electronAPI.shells.onExit((exited) => {
      if (exited.sessionId !== session.id) return;
      setShells((prev) =>
        prev.map((s) => (s.id === exited.id ? { ...s, status: exited.status } : s)),
      );
    });
    return () => unsub();
  }, [session.id]);

  const handleOpenShell = useCallback(
    async (placement: ShellPlacement = isRemoteSshSession ? 'remote' : 'local') => {
      if (!running) return;
      try {
        const shell = await window.electronAPI.shells.open(
          session.id,
          isRemoteSshSession ? { placement } : undefined,
        );
        setShells((prev) => [...prev, shell]);
        setActivePane(`shell:${shell.id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSyncMessage(message);
        setSyncIsError(true);
      }
    },
    [isRemoteSshSession, running, session.id],
  );

  const handleCloseShell = useCallback(
    async (shellId: string) => {
      await window.electronAPI.shells.close(shellId);
      invalidateShellAttachCache(shellId);
      setShells((prev) => prev.filter((s) => s.id !== shellId));
      setActivePane((prev) => (prev === `shell:${shellId}` ? 'agent' : prev));
    },
    [],
  );

  const handleSyncToLocal = useCallback(async () => {
    if (!isRemoteSshSession || syncLoading) return;
    setSyncLoading(true);
    setSyncMessage(null);
    setSyncIsError(false);
    try {
      const result = await window.electronAPI.sessions.syncToLocal(session.id);
      if (result.ok) {
        setSyncMessage(remoteSshSyncSuccessDetail(result));
        setSyncIsError(false);
        setLocalWorktreePath(result.localWorktreePath);
      } else {
        setSyncMessage(remoteSshSyncFailureDetail(result));
        setSyncIsError(true);
      }
    } catch {
      setSyncMessage('Sync to local failed unexpectedly.');
      setSyncIsError(true);
    } finally {
      setSyncLoading(false);
    }
  }, [isRemoteSshSession, session.id, syncLoading]);

  const toolbarActionClass =
    'shrink-0 border-status-terminal-foreground/15 bg-status-terminal-foreground/5 text-status-terminal-foreground hover:bg-status-terminal-foreground/10';

  const validationEnabledProject = taskDetailPanel?.validationEnabledProject === true;
  const validateEligibility = useMemo(
    () =>
      task
        ? evaluateValidateActionEligibility({
            validationEnabled: validationEnabledProject,
            task,
            latestRun,
          })
        : { canValidate: false },
    [task, validationEnabledProject, latestRun],
  );

  return (
    <div className={terminalWorkspaceShellClass}>
      <div className={terminalToolbarClass}>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 pl-0.5">
          {showDetailsTab ? (
            <TerminalWorkspaceTab
              label="Details"
              active={activePane === 'details'}
              onClick={() => setActivePane('details')}
              icon={
                <LayoutList
                  className="h-3.5 w-3.5 shrink-0 opacity-80"
                  strokeWidth={2}
                  aria-hidden
                />
              }
            />
          ) : null}
          <TerminalWorkspaceTab
            label="Agent"
            active={activePane === 'agent'}
            onClick={() => setActivePane('agent')}
            icon={<BotIcon className="shrink-0 opacity-80" />}
          />
          {showValidationTab ? (
            <TerminalWorkspaceTab
              label="Validation"
              active={activePane === 'validation'}
              onClick={() => setActivePane('validation')}
              status={
                validatorSession?.status === 'running' || validationRunPending ? 'running' : 'idle'
              }
              icon={
                <ShieldCheck
                  className="h-3.5 w-3.5 shrink-0 opacity-80"
                  strokeWidth={2}
                  aria-hidden
                />
              }
            />
          ) : null}
          {shells.map((shell) => (
            <TerminalWorkspaceTab
              key={shell.id}
              label={isRemoteSshSession ? shellTabLabel(shell, shells) : `Terminal ${shells.indexOf(shell) + 1}`}
              active={activePane === `shell:${shell.id}`}
              onClick={() => setActivePane(`shell:${shell.id}`)}
              onClose={() => void handleCloseShell(shell.id)}
              status={shell.status}
            />
          ))}
          {isRemoteSshSession ? (
            <SessionShellAddMenu
              running={running}
              localWorktreeAvailable={localWorktreeAvailable}
              onOpenShell={handleOpenShell}
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={!running}
              onClick={() => void handleOpenShell()}
              title={running ? 'Open a new terminal in this worktree' : 'Session is not running'}
              aria-label="Open a new terminal in this worktree"
              className={cn(
                'ml-1 size-6 shrink-0 text-base leading-none',
                running
                  ? 'text-status-terminal-foreground/70 hover:bg-status-terminal-foreground/10 hover:text-status-terminal-foreground'
                  : 'text-status-terminal-foreground/30',
              )}
            >
              +
            </Button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isRemoteSshSession ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={syncLoading}
              onClick={() => void handleSyncToLocal()}
              title="Push the remote task branch and fetch it into your local worktree"
              className={cn(
                toolbarActionClass,
                'border-status-review/30 text-status-review-foreground hover:bg-status-review/15',
                syncLoading && 'cursor-wait opacity-60',
              )}
            >
              {syncLoading ? 'Syncing…' : 'Sync to local'}
            </Button>
          ) : null}
          {validateEligibility.canValidate && task && taskDetailPanel?.onUpdate ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => taskDetailPanel.onUpdate!(task.id, { status: 'validation' })}
              title={validateEligibility.message}
              className={cn('shrink-0 gap-1.5', validateButtonClassNameForStatus(task.status))}
            >
              <ShieldCheck data-icon="inline-start" strokeWidth={2} aria-hidden />
              Validate
            </Button>
          ) : null}
          <OpenInWorkspaceButton
            worktreePath={isRemoteSshSession ? localWorktreePath : session.worktreePath}
            disabledReason={
              isRemoteSshSession
                ? 'Sync to local first to open the local copy in Cursor, VS Code, or Terminal.'
                : undefined
            }
            size="sm"
          />
          {task ? (
            <GithubPrIconButton
              githubPr={task.githubPr}
              taskId={task.id}
              taskStatus={task.status}
              hasWorktree={Boolean(session.worktreePath?.trim())}
              onTaskPrClick={onTaskPrClick}
              prLoading={prLoading}
              prAgentAwaiting={prAgentAwaiting}
            />
          ) : null}
          {showMarkAsDone ? (
            <Button
              type="button"
              variant="outline"
              disabled={markDoneDisabled}
              onClick={() => onMarkAsDone?.()}
              title={
                markAsDoneBlocked
                  ? 'Finish blocking tasks before marking this task done'
                  : 'Move task to Done and open the board'
              }
              className={cn(
                'h-auto shrink-0 px-3 py-1.5 text-[12px]',
                workspaceToolbarActionButtonClass,
                markDoneDisabled && workspaceToolbarActionButtonDisabledClass,
              )}
            >
              Mark as done
            </Button>
          ) : null}
          {showCleanUp ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={cleanUpDisabled}
              onClick={() => onRequestCleanupTask?.()}
              title={
                cleanupLoading
                  ? 'Cleaning up workspace…'
                  : 'Tear down agent session, terminals, and worktree for this task'
              }
              className={cn(toolbarActionClass, cleanUpDisabled && 'opacity-50')}
            >
              {cleanupLoading ? 'Cleaning up…' : 'Clean up'}
            </Button>
          ) : null}
        </div>
      </div>
      {syncMessage ? (
        <TerminalStatusBanner variant={syncIsError ? 'error' : 'success'}>
          {syncMessage}
        </TerminalStatusBanner>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {showDetailsTab && task && taskDetailPanel ? (
          <div
            aria-hidden={!visible || activePane !== 'details'}
            className="absolute inset-0 min-h-0 overflow-hidden"
            style={paneVisibilityStyle(visible && activePane === 'details')}
          >
            <TaskDetailPanel
              {...taskDetailPanel}
              task={task}
              layout="sessionWorkspace"
              onClose={() => {
                /* No overlay — Escape and backdrop are disabled in sessionWorkspace layout. */
              }}
            />
          </div>
        ) : null}
        <AgentPane
          session={session}
          visible={visible && activePane === 'agent'}
          task={task}
          agentSessionLifecycle={agentSessionLifecycle}
          onAgentSessionStartSuccess={onAgentSessionStartSuccess}
        />
        {showValidationTab ? (
          <ValidationPane
            session={validatorSession}
            visible={visible && activePane === 'validation'}
            runPending={validationRunPending}
            awaitingPty={validationRunAwaitingPty}
          />
        ) : null}
        {shells.map((shell) => (
          <ShellPane
            key={shell.id}
            shell={shell}
            visible={visible && activePane === `shell:${shell.id}`}
          />
        ))}
      </div>
    </div>
  );
}
