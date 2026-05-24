import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LayoutList } from 'lucide-react';
import type { Agent, Session, Shell, ShellPlacement, Task } from '../types';
import TaskDetailPanel, { type TaskDetailPanelProps } from './TaskDetailPanel';
import { GithubPrIconButton } from './GithubPrIconButton';
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

type PaneId = 'details' | 'agent' | `shell:${string}`;

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

  const resumeBtnPrimary =
    'rounded-lg bg-emerald-500/90 px-4 py-2 text-[13px] font-medium text-emerald-950 shadow-sm transition hover:bg-emerald-400/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b] disabled:cursor-not-allowed';
  const resumeBtnIdle = `${resumeBtnPrimary} disabled:bg-zinc-800/80 disabled:text-zinc-500 disabled:shadow-none`;
  const resumeBtnError =
    'rounded-lg border border-red-500/35 bg-red-500/[0.12] px-4 py-2 text-[13px] font-medium text-red-200/90 transition hover:bg-red-500/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40';
  const resumeBtnLoading =
    'cursor-wait rounded-lg bg-zinc-800/90 px-4 py-2 text-[13px] font-medium text-zinc-500';
  const newSessionBtn =
    'rounded-lg bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-zinc-100 ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div
      aria-hidden={!visible}
      className="absolute inset-0 p-3"
      style={paneVisibilityStyle(visible)}
    >
      {running ? (
        <div className="relative h-full min-h-0">
          {!attachReady ? (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md border border-white/[0.06] bg-[#0a0a0c]/95 text-[13px] text-zinc-400"
              aria-live="polite"
              aria-busy="true"
            >
              <span
                className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300"
                aria-hidden
              />
              <span className="font-medium text-zinc-300">Starting…</span>
            </div>
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
      ) : remoteInterrupted && session.remoteLifecycleStatus ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-8 text-center">
          <p className="text-[15px] font-medium text-zinc-200">
            {remoteLifecycleStatusHeading(session.remoteLifecycleStatus)}
          </p>
          <p className="max-w-lg text-[13px] leading-relaxed text-zinc-500">
            {remoteLifecycleStatusDetail(session.remoteLifecycleStatus, session)}
          </p>
          {session.remoteLifecycleStatus === 'device-unreachable' ||
          session.remoteLifecycleStatus === 'helper-mismatch' ? (
            <button
              type="button"
              onClick={() => void handleRemoteRetry()}
              disabled={remoteRetryLoading}
              className={
                remoteRetryLoading
                  ? resumeBtnLoading
                  : 'rounded-lg bg-emerald-500/90 px-4 py-2 text-[13px] font-medium text-emerald-950 shadow-sm transition hover:bg-emerald-400/90'
              }
            >
              {remoteRetryLoading ? 'Retrying…' : 'Retry connection'}
            </button>
          ) : null}
          {restartError ? (
            <p className="max-w-sm text-xs leading-snug text-red-300/90" role="alert">
              {restartError}
            </p>
          ) : null}
        </div>
      ) : showRestartControls ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-6 text-center">
          <p className="text-[13px] text-zinc-500">This session is no longer running.</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void handleAgentRestart(true)}
              disabled={restartLoading || blocked}
              title={
                blocked
                  ? 'Blocked by incomplete dependencies'
                  : 'Continue the CLI session from disk (--resume)'
              }
              className={
                restartLoading
                  ? resumeBtnLoading
                  : restartError
                    ? resumeBtnError
                    : blocked
                      ? 'cursor-not-allowed rounded-lg bg-zinc-800/50 px-4 py-2 text-[13px] font-medium text-zinc-500 ring-1 ring-inset ring-white/[0.06]'
                      : resumeBtnIdle
              }
            >
              {blocked ? 'Blocked' : restartError ? 'Retry' : 'Resume'}
            </button>
            <button
              type="button"
              onClick={() => void handleAgentRestart(false)}
              disabled={restartLoading || blocked}
              title={
                blocked
                  ? 'Blocked by incomplete dependencies'
                  : 'Start a new agent session with the full task prompt'
              }
              className={
                restartLoading || blocked ? `${newSessionBtn} disabled:cursor-not-allowed` : newSessionBtn
              }
            >
              {blocked ? 'Blocked' : 'New session'}
            </button>
          </div>
          {restartError && !blocked ? (
            <p className="max-w-sm text-xs leading-snug text-red-300/90" role="alert">
              {restartError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-[13px] text-zinc-500">
          This session is no longer running.
        </div>
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
        <div className="flex h-full items-center justify-center text-[13px] text-zinc-500">
          Shell exited.
        </div>
      )}
    </div>
  );
}

function PaneTab({
  label,
  active,
  onClick,
  onClose,
  status,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
  status?: 'running' | 'stopped' | 'error' | 'idle';
  icon?: ReactNode;
}) {
  const running = status === 'running';
  return (
    <div
      className={[
        'group flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors',
        active
          ? 'bg-white/[0.06] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
          : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-200',
      ].join(' ')}
    >
      <button type="button" onClick={onClick} className="flex items-center gap-1.5">
        {icon ? (
          icon
        ) : status ? (
          <span
            className={[
              'inline-block h-1.5 w-1.5 rounded-full',
              running ? 'bg-emerald-400' : 'bg-zinc-600',
            ].join(' ')}
            aria-hidden
          />
        ) : null}
        <span>{label}</span>
      </button>
      {onClose ? (
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-zinc-600 opacity-60 transition hover:bg-white/[0.08] hover:text-zinc-200 hover:opacity-100"
        >
          <span className="text-[12px] leading-none" aria-hidden>
            ×
          </span>
        </button>
      ) : null}
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
  const showDetailsTab = Boolean(task && taskDetailPanel);

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

  const markDoneBtn =
    'shrink-0 rounded-lg bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-zinc-100 ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25';
  const markDoneBtnDisabled =
    'shrink-0 cursor-not-allowed rounded-lg bg-zinc-800/50 px-3 py-1.5 text-[12px] font-medium text-zinc-500 ring-1 ring-inset ring-white/[0.06]';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#09090b]">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.05] bg-[#0a0a0b] pl-1 pr-2.5 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 pl-0.5">
          {showDetailsTab ? (
            <PaneTab
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
          <PaneTab
            label="Agent"
            active={activePane === 'agent'}
            onClick={() => setActivePane('agent')}
            icon={<BotIcon className="shrink-0 opacity-80" />}
          />
          {shells.map((shell) => (
            <PaneTab
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
            <button
              type="button"
              onClick={() => void handleOpenShell()}
              disabled={!running}
              title={running ? 'Open a new terminal in this worktree' : 'Session is not running'}
              aria-label="Open a new terminal in this worktree"
              className={[
                'ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[16px] leading-none transition',
                running
                  ? 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
                  : 'cursor-not-allowed text-zinc-700',
              ].join(' ')}
            >
              +
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isRemoteSshSession ? (
            <button
              type="button"
              onClick={() => void handleSyncToLocal()}
              disabled={syncLoading}
              title="Push the remote task branch and fetch it into your local worktree"
              className={[
                'shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium ring-1 ring-inset transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25',
                syncLoading
                  ? 'cursor-wait bg-zinc-800/80 text-zinc-500 ring-white/[0.06]'
                  : 'bg-sky-500/10 text-sky-100 ring-sky-400/25 hover:bg-sky-500/15',
              ].join(' ')}
            >
              {syncLoading ? 'Syncing…' : 'Sync to local'}
            </button>
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
              hasWorktree={Boolean(session.worktreePath?.trim())}
              onTaskPrClick={onTaskPrClick}
              prLoading={prLoading}
              prAgentAwaiting={prAgentAwaiting}
            />
          ) : null}
          {showMarkAsDone ? (
            <button
              type="button"
              onClick={() => onMarkAsDone?.()}
              disabled={markDoneDisabled}
              title={
                markAsDoneBlocked
                  ? 'Finish blocking tasks before marking this task done'
                  : 'Move task to Done and open the board'
              }
              className={markDoneDisabled ? markDoneBtnDisabled : markDoneBtn}
            >
              Mark as done
            </button>
          ) : null}
        </div>
      </div>
      {syncMessage ? (
        <div
          className={[
            'shrink-0 border-b px-3 py-2 text-[12px] leading-snug',
            syncIsError
              ? 'border-red-500/20 bg-red-500/10 text-red-200/90'
              : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100/90',
          ].join(' ')}
          role={syncIsError ? 'alert' : 'status'}
        >
          {syncMessage}
        </div>
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
