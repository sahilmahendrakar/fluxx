import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ExternalLink } from 'lucide-react';
import { AGENTS, type Agent, type PlanningSession, type Project } from '../types';
import { getPlanningAttachShared, invalidatePlanningAttachCache } from '../terminal/warmAttach';
import {
  OWNER_TERMINAL_VIEW_POLICY,
  terminalShouldAutoFit,
} from '../terminal/terminalGeometryPolicy';
import { useTerminalPtyStream } from '../terminal/useTerminalPtyStream';
import Terminal, { type TerminalHandle } from './Terminal';

export interface PlanningPanelProps {
  project: Project;
  onClose: () => void;
  /** After planning agent prefs are saved, reload `project` from the main process / binding store. */
  onLocalProjectRefresh?: () => void | Promise<void>;
  /** Daemon-backed sessions for this project (caller refetches). */
  sessions: PlanningSession[];
  /** Which session's PTY is shown in the embedded terminal. */
  activeSessionId: string | null;
  onActiveSessionChange: (id: string | null) => void;
  /** Called after start/stop/exit so the parent can `planning.list()` again. */
  onSessionsMutated: () => void | Promise<void>;
  layout: 'sidebar' | 'fullscreen';
  /** Opens the dedicated main-window tab for one planning session. */
  onOpenInMainTab?: (sessionId: string) => void;
}

const OUTPUT_TAIL_MAX = 12_000;

const ESC = String.fromCharCode(27);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');

function stripAnsi(s: string): string {
  return s.replace(ANSI_ESCAPE_PATTERN, '');
}

function tailNeedsInputHint(text: string): boolean {
  const tail = stripAnsi(text).slice(-OUTPUT_TAIL_MAX);
  const lines = tail.split(/\r?\n/);
  const lastLine = (lines[lines.length - 1] ?? '').trimEnd();
  return (
    lastLine.endsWith('?') ||
    tail.includes('Would you like') ||
    tail.includes('Should I')
  );
}

function planningTabLabel(s: PlanningSession, index: number): string {
  const agent = AGENTS.find((a) => a.id === s.agent)?.label ?? s.agent;
  return `Plan ${index + 1} · ${agent}`;
}

export function PlanningPanel({
  project,
  onClose,
  onLocalProjectRefresh,
  sessions,
  activeSessionId,
  onActiveSessionChange,
  onSessionsMutated,
  layout,
  onOpenInMainTab,
}: PlanningPanelProps) {
  const planningApi = window.electronAPI.planning;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsInput, setNeedsInput] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent>(() =>
    project.kind === 'local'
      ? project.planningAgent
      : (project.planningAgent ?? 'claude-code'),
  );
  const terminalRef = useRef<TerminalHandle | null>(null);
  const outputBufferRef = useRef('');
  const activeSessionRef = useRef<PlanningSession | null>(null);

  const activeSession =
    activeSessionId == null
      ? null
      : (sessions.find((s) => s.id === activeSessionId) ?? null);
  activeSessionRef.current = activeSession;

  useEffect(() => {
    setSelectedAgent(
      project.kind === 'local'
        ? project.planningAgent
        : (project.planningAgent ?? 'claude-code'),
    );
  }, [project]);

  useEffect(() => {
    setError(null);
    setNeedsInput(false);
    outputBufferRef.current = '';
  }, [project.id]);

  useEffect(() => {
    if (!planningApi) return;
    return planningApi.onExit((exited) => {
      void onSessionsMutated();
      invalidatePlanningAttachCache(exited.id);
      if (activeSessionRef.current?.id === exited.id) {
        setNeedsInput(false);
        outputBufferRef.current = '';
      }
    });
  }, [planningApi, onSessionsMutated]);

  const appendOutputAndDetectNeedsInput = useCallback((chunk: string) => {
    outputBufferRef.current = (
      outputBufferRef.current + chunk
    ).slice(-OUTPUT_TAIL_MAX);
    if (activeSessionRef.current?.status === 'running') {
      setNeedsInput(tailNeedsInputHint(outputBufferRef.current));
    }
  }, []);

  const planningStreamEnabled = Boolean(
    planningApi && activeSession && activeSession.status === 'running',
  );
  const activePlanningId = activeSession?.id;

  useTerminalPtyStream({
    terminalRef,
    id: activePlanningId ?? '',
    enabled: planningStreamEnabled,
    viewPolicy: OWNER_TERMINAL_VIEW_POLICY,
    getAttach: () => {
      if (!planningApi || !activePlanningId) {
        return Promise.resolve(null);
      }
      return getPlanningAttachShared(activePlanningId, async () => {
        try {
          return await planningApi.attach(activePlanningId);
        } catch (err) {
          console.error('[PlanningPanel] attach failed', err);
          return null;
        }
      });
    },
    onStreamData: (id, cb) => {
      if (!planningApi) {
        return () => undefined;
      }
      return planningApi.onData(id, cb);
    },
    onDataChunk: appendOutputAndDetectNeedsInput,
  });

  useEffect(() => {
    if (needsInput) terminalRef.current?.focus();
  }, [needsInput]);

  const handleStart = async () => {
    if (!planningApi) {
      setError('Planning assistant is not available in this build.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await planningApi.start(selectedAgent);
      if (result && typeof result === 'object' && 'error' in result) {
        const err = result as { error: string; message?: string };
        setError(err.message ?? err.error ?? 'Failed to start');
        return;
      }
      const session = result as PlanningSession;
      await onSessionsMutated();
      onActiveSessionChange(session.id);
      await onLocalProjectRefresh?.();
    } catch {
      setError('Failed to start session');
    } finally {
      setLoading(false);
    }
  };

  const handleStopOne = async (sessionId: string) => {
    if (!planningApi) return;
    setLoading(true);
    setError(null);
    try {
      await planningApi.stop(sessionId);
      invalidatePlanningAttachCache(sessionId);
      await onSessionsMutated();
      if (activeSessionId === sessionId) {
        onActiveSessionChange(null);
      }
      setNeedsInput(false);
      outputBufferRef.current = '';
    } catch {
      setError('Failed to stop session');
    } finally {
      setLoading(false);
    }
  };

  const handleTerminalData = (data: string) => {
    if (
      planningApi &&
      activeSessionRef.current?.status === 'running' &&
      activeSessionRef.current.id
    ) {
      planningApi.write(activeSessionRef.current.id, data);
    }
  };

  const sessionRunning = activeSession?.status === 'running';
  const agentSelectValue =
    sessionRunning && activeSession
      ? activeSession.agent
      : selectedAgent;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-gray-800 bg-[#0a0a0a]">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-gray-800 px-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              sessionRunning ? 'bg-green-500' : 'bg-gray-600'
            }`}
            aria-hidden
          />
          <span className="truncate text-xs font-medium text-gray-200">
            Planning assistant
          </span>
          {sessionRunning && needsInput ? (
            <span className="shrink-0 rounded-full border border-amber-900 bg-amber-950 px-1.5 py-0.5 text-[9px] text-amber-400">
              needs input
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {sessionRunning && activeSession ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleStopOne(activeSession.id)}
              className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] font-medium text-gray-300 transition hover:bg-gray-800 disabled:opacity-50"
            >
              Stop
            </button>
          ) : null}
          <select
            aria-label="Planning agent"
            title={
              sessionRunning
                ? 'Agent for this session'
                : 'Planning agent for the next session (saved when you change it or start).'
            }
            disabled={sessionRunning}
            value={agentSelectValue}
            onChange={(e) => {
              const next = e.target.value as Agent;
              setSelectedAgent(next);
              void (async () => {
                const res = await window.electronAPI.project.setPlanningAgent(next);
                if ('error' in res) {
                  setError(res.error);
                  setSelectedAgent(
                    project.kind === 'local'
                      ? project.planningAgent
                      : (project.planningAgent ?? 'claude-code'),
                  );
                  return;
                }
                setError(null);
                await onLocalProjectRefresh?.();
              })();
            }}
            className="min-w-0 max-w-[9.5rem] cursor-pointer rounded-md border border-gray-700 bg-gray-900 py-1 pl-2 pr-7 text-[11px] font-medium text-gray-200 focus:border-gray-600 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-800 hover:text-gray-200"
            aria-label="Close planning panel"
          >
            ×
          </button>
        </div>
      </header>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-800/80 px-2 py-1.5">
        {sessions.map((s, i) => {
          const sel = s.id === activeSessionId;
          const running = s.status === 'running';
          return (
            <div
              key={s.id}
              className={[
                'flex shrink-0 items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px]',
                sel
                  ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-100'
                  : 'border-gray-800 bg-gray-900/60 text-gray-400',
              ].join(' ')}
            >
              <button
                type="button"
                className="flex max-w-[11rem] items-center gap-1 truncate"
                onClick={() => onActiveSessionChange(s.id)}
                title={planningTabLabel(s, i)}
              >
                <span
                  className={[
                    'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                    running ? 'bg-emerald-400' : 'bg-zinc-600',
                  ].join(' ')}
                  aria-hidden
                />
                <span className="truncate">{planningTabLabel(s, i)}</span>
              </button>
              {onOpenInMainTab ? (
                <button
                  type="button"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-800 hover:text-gray-200"
                  aria-label="Open planning session in a new tab"
                  title="Open in new tab"
                  onClick={() => onOpenInMainTab(s.id)}
                >
                  <ExternalLink className="h-3 w-3" strokeWidth={2} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-red-950/50 hover:text-red-300"
                aria-label={`Close ${planningTabLabel(s, i)}`}
                title="Close tab and stop session"
                onClick={() => void handleStopOne(s.id)}
              >
                <span className="text-[12px] leading-none" aria-hidden>
                  ×
                </span>
              </button>
            </div>
          );
        })}
        <button
          type="button"
          disabled={loading || !planningApi}
          onClick={() => void handleStart()}
          className="shrink-0 rounded-md border border-dashed border-gray-700 px-2 py-0.5 text-[10px] font-medium text-gray-400 hover:border-gray-600 hover:bg-gray-900 hover:text-gray-200 disabled:opacity-40"
        >
          + Session
        </button>
      </div>

      {error ? (
        <div className="shrink-0 border-b border-red-900/50 bg-red-950/40 px-2.5 py-1.5 text-[10px] text-red-300">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0a]">
        {!planningApi ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-gray-500">Planning assistant unavailable</p>
            <p className="text-[10px] leading-relaxed text-gray-600">
              This build does not expose planning IPC yet. Sessions will work once
              the main process and preload wire up{' '}
              <span className="font-mono text-gray-500">electronAPI.planning</span>
              .
            </p>
          </div>
        ) : sessionRunning && activeSession ? (
          <div
            className={
              layout === 'sidebar'
                ? 'flex min-h-0 flex-1 flex-col px-3 py-2'
                : 'flex min-h-0 flex-1 flex-col px-4 py-3'
            }
          >
            <div className="min-h-0 flex-1 overflow-hidden">
              <Terminal
                ref={terminalRef}
                sessionId={activeSession.id}
                onData={handleTerminalData}
                onResize={(cols, rows) =>
                  planningApi.resize(activeSession.id, cols, rows)
                }
                autoFit={terminalShouldAutoFit(OWNER_TERMINAL_VIEW_POLICY)}
                hideCursor
              />
            </div>
          </div>
        ) : activeSession && !sessionRunning ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-gray-500">This planning session has ended</p>
            <p className="text-[10px] text-gray-600">
              Close the tab or start another session from + Session.
            </p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-gray-600">Select a session or start a new one</p>
            <p className="text-[10px] leading-relaxed text-gray-700">
              Multiple assistants can run at once — switch tabs without stopping others.
            </p>
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleStart()}
              className="mt-2 rounded-md bg-green-900 px-3 py-1.5 text-xs text-green-300 transition-colors hover:bg-green-800 disabled:opacity-50"
            >
              {loading ? 'Starting…' : 'Start session'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
