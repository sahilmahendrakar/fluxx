import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AgentModelUiKind } from '../agentModelUi';
import { labelForModelId } from '../agentModelUi';
import {
  AgentSessionPrefsMenuContent,
  AgentSessionPrefsMenuPortal,
  agentModelUiKindForAgent,
} from './AgentSessionPrefsMenu';
import {
  migrateLegacyPlanningModelsIfNeeded,
  readPlanningModelsForProject,
} from '../planningSessionModelPrefs';
import {
  buildPlanningResumePayload,
  buildPlanningStartPayload,
} from '../planningSessionStartPayload';
import {
  AGENTS,
  DEFAULT_CURSOR_AGENT_MODEL,
  type Agent,
  type PlanningSession,
  type Project,
} from '../types';
import { getPlanningAttachShared, invalidatePlanningAttachCache } from '../terminal/warmAttach';
import {
  OWNER_TERMINAL_VIEW_POLICY,
  terminalShouldAutoFit,
} from '../terminal/terminalGeometryPolicy';
import { useTerminalPtyStream } from '../terminal/useTerminalPtyStream';
import Terminal, { type TerminalHandle } from './Terminal';
import {
  isPlanningSessionResumable,
  planningResumeButtonTitle,
  planningResumeDismissTitle,
  planningResumeStateDetail,
  planningResumeStateHeading,
  planningSessionHasWarmTerminal,
  planningTabLabel,
} from './planningResumeUi';

/**
 * Header “Add session” prefs:
 * - **Agent** → `project.setPlanningAgent` (config.json / cloud binding).
 * - **Model** and **YOLO** → `project.patchAgentSpawnDefaults`; legacy `localStorage` is migrated once.
 */

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

function planningPaneVisibilityStyle(visible: boolean): React.CSSProperties {
  return {
    visibility: visible ? 'visible' : 'hidden',
    pointerEvents: visible ? 'auto' : 'none',
    zIndex: visible ? 1 : 0,
  };
}

function defaultPlanningAgent(p: Project): Agent {
  return p.kind === 'local' ? p.planningAgent : (p.planningAgent ?? 'claude-code');
}

function PlanningTerminalPane({
  session,
  visible,
  layout,
  needsInput,
  onDataChunk,
}: {
  session: PlanningSession;
  visible: boolean;
  layout: 'sidebar' | 'fullscreen';
  needsInput: boolean;
  onDataChunk: (chunk: string) => void;
}) {
  const planningApi = window.electronAPI.planning;
  const terminalRef = useRef<TerminalHandle | null>(null);
  const running = session.status === 'running';
  const warmTerminal = planningSessionHasWarmTerminal(session);

  useTerminalPtyStream({
    terminalRef,
    id: session.id,
    enabled: Boolean(planningApi && warmTerminal),
    viewPolicy: OWNER_TERMINAL_VIEW_POLICY,
    getAttach: () => {
      if (!planningApi) {
        return Promise.resolve(null);
      }
      return getPlanningAttachShared(session.id, async () => {
        try {
          return await planningApi.attach(session.id);
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
    onDataChunk: visible ? onDataChunk : undefined,
  });

  useEffect(() => {
    if (visible && needsInput) terminalRef.current?.focus();
  }, [needsInput, visible]);

  const handleTerminalData = (data: string) => {
    if (planningApi && running) {
      planningApi.write(session.id, data);
    }
  };

  return (
    <div
      aria-hidden={!visible}
      className="absolute inset-0 flex min-h-0 flex-col"
      style={planningPaneVisibilityStyle(visible)}
    >
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
            sessionId={session.id}
            onData={handleTerminalData}
            onResize={
              visible && running && planningApi
                ? (cols, rows) => planningApi.resize(session.id, cols, rows)
                : undefined
            }
            visible={visible}
            autoFit={terminalShouldAutoFit(OWNER_TERMINAL_VIEW_POLICY)}
            hideCursor
          />
        </div>
      </div>
    </div>
  );
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
  const [selectedAgent, setSelectedAgent] = useState<Agent>(() => defaultPlanningAgent(project));
  const [claudeModelId, setClaudeModelId] = useState('');
  const [cursorModelId, setCursorModelId] = useState(DEFAULT_CURSOR_AGENT_MODEL);
  const [codexModelId, setCodexModelId] = useState('');
  const [planningYolo, setPlanningYolo] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const outputBufferRef = useRef('');
  const activeSessionRef = useRef<PlanningSession | null>(null);
  const splitAnchorRef = useRef<HTMLDivElement>(null);
  const prefsDropdownRef = useRef<HTMLDivElement>(null);

  const activeSession =
    activeSessionId == null
      ? null
      : (sessions.find((s) => s.id === activeSessionId) ?? null);
  activeSessionRef.current = activeSession;

  const activeModelId =
    selectedAgent === 'cursor'
      ? cursorModelId
      : selectedAgent === 'claude-code'
        ? claudeModelId
        : selectedAgent === 'codex'
          ? codexModelId
          : '';

  useEffect(() => {
    setSelectedAgent(defaultPlanningAgent(project));
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mainHas =
        project.planningModels != null &&
        Object.keys(project.planningModels).length > 0;
      const migrated = await migrateLegacyPlanningModelsIfNeeded(project.id, mainHas);
      if (migrated) {
        await onLocalProjectRefresh?.();
      }
      if (cancelled) return;
      const fallback = readPlanningModelsForProject(project.id);
      const claude =
        typeof project.planningModels?.['claude-code'] === 'string'
          ? project.planningModels['claude-code']
          : fallback['claude-code'];
      const cursor =
        typeof project.planningModels?.cursor === 'string'
          ? project.planningModels.cursor
          : fallback.cursor;
      const codex =
        typeof project.planningModels?.codex === 'string' ? project.planningModels.codex : '';
      setClaudeModelId(claude);
      setCursorModelId(cursor);
      setCodexModelId(codex);
      setPlanningYolo(project.planningAgentYolo === true);
      setError(null);
      setNeedsInput(false);
      outputBufferRef.current = '';
      setPrefsOpen(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    project.id,
    JSON.stringify(project.planningModels ?? {}),
    project.planningAgentYolo,
    onLocalProjectRefresh,
  ]);

  const closePrefsMenu = useCallback(() => {
    setPrefsOpen(false);
  }, []);

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

  const persistPlanningAgent = useCallback(
    async (next: Agent) => {
      const res = await window.electronAPI.project.setPlanningAgent(next);
      if ('error' in res) {
        setError(res.error);
        setSelectedAgent(defaultPlanningAgent(project));
        return false;
      }
      setError(null);
      await onLocalProjectRefresh?.();
      return true;
    },
    [onLocalProjectRefresh, project],
  );

  const handleAgentPick = (next: Agent | null) => {
    if (next == null) return;
    setSelectedAgent(next);
    void (async () => {
      await persistPlanningAgent(next);
    })();
  };

  const handleModelPick = (kind: AgentModelUiKind, id: string) => {
    if (kind === 'claude-code') {
      setClaudeModelId(id);
    } else if (kind === 'codex') {
      setCodexModelId(id);
    } else {
      const norm = id.trim() || DEFAULT_CURSOR_AGENT_MODEL;
      setCursorModelId(norm);
    }
    void (async () => {
      const patch =
        kind === 'claude-code'
          ? { planningModels: { 'claude-code': id } as const }
          : kind === 'codex'
            ? { planningModels: { codex: id.trim() } as const }
            : {
                planningModels: {
                  cursor: (id.trim() || DEFAULT_CURSOR_AGENT_MODEL) as string,
                },
              };
      const res = await window.electronAPI.project.patchAgentSpawnDefaults(patch);
      if ('error' in res) {
        setError(res.error);
        return;
      }
      await onLocalProjectRefresh?.();
    })();
    closePrefsMenu();
  };

  const persistPlanningYolo = useCallback(
    async (next: boolean) => {
      setPlanningYolo(next);
      const res = await window.electronAPI.project.patchAgentSpawnDefaults({
        planningAgentYolo: next,
      });
      if ('error' in res) {
        setError(res.error);
        setPlanningYolo(!next);
        return;
      }
      setError(null);
      await onLocalProjectRefresh?.();
    },
    [onLocalProjectRefresh],
  );

  const planningModelIds = {
    cursor: cursorModelId,
    'claude-code': claudeModelId,
    codex: codexModelId,
  };

  const buildStartPayload = (agent: Agent = selectedAgent) =>
    buildPlanningStartPayload({
      agent,
      modelIds: planningModelIds,
      planningYolo,
    });

  const buildResumePayload = (session: PlanningSession) =>
    buildPlanningResumePayload(session, {
      modelIds: planningModelIds,
      planningYolo,
    });

  const handleStart = async () => {
    if (!planningApi) {
      setError('Planning assistant is not available in this build.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await planningApi.start(buildStartPayload());
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

  const handleResume = async (session: PlanningSession) => {
    if (!planningApi) {
      setError('Planning assistant is not available in this build.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await planningApi.start(buildResumePayload(session));
      if (result && typeof result === 'object' && 'error' in result) {
        const err = result as { error: string; message?: string };
        setError(err.message ?? err.error ?? 'Failed to resume');
        return;
      }
      const live = result as PlanningSession;
      await onSessionsMutated();
      onActiveSessionChange(live.id);
      await onLocalProjectRefresh?.();
    } catch {
      setError('Failed to resume session');
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

  const sessionRunning = activeSession?.status === 'running';
  const activeResumable =
    activeSession != null && isPlanningSessionResumable(activeSession);
  const activeWarmTerminal =
    activeSession != null && planningSessionHasWarmTerminal(activeSession);
  const resumableCount = sessions.filter(isPlanningSessionResumable).length;

  const resumeActions =
    activeSession && activeResumable ? (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={loading || !planningApi}
          onClick={() => void handleResume(activeSession)}
          title={planningResumeButtonTitle(activeSession.agentConversationId)}
          className="bg-status-success text-status-success-foreground hover:bg-status-success/90"
        >
          {loading ? 'Starting…' : 'Resume'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading || !planningApi}
          onClick={() => void handleStart()}
          title="Start a new planning session with the agent and model chosen in the header"
        >
          Start new
        </Button>
      </div>
    ) : null;
  const mk = agentModelUiKindForAgent(selectedAgent);
  const modelSummary =
    mk === 'claude-code' && !claudeModelId.trim()
      ? 'Default'
      : mk
        ? labelForModelId(mk, activeModelId)
        : '—';

  const prefsMenu = (
    <AgentSessionPrefsMenuPortal
      open={prefsOpen}
      anchorRef={splitAnchorRef}
      dropdownRef={prefsDropdownRef}
      onClose={closePrefsMenu}
      ariaLabel="Next planning session"
    >
      <AgentSessionPrefsMenuContent
        selectedAgent={selectedAgent}
        claudeModelId={claudeModelId}
        cursorModelId={cursorModelId}
        codexModelId={codexModelId}
        agentYolo={planningYolo}
        onPickAgent={handleAgentPick}
        onPickModel={handleModelPick}
        onToggleYolo={(next) => void persistPlanningYolo(next)}
      />
    </AgentSessionPrefsMenuPortal>
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-border bg-card">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              sessionRunning
                ? 'bg-status-success'
                : activeResumable
                  ? 'bg-status-needs-input'
                  : 'bg-muted-foreground/50',
            )}
            aria-hidden
          />
          <span className="truncate text-xs font-medium text-card-foreground">
            Planning assistant
          </span>
          {sessionRunning && needsInput ? (
            <Badge
              variant="outline"
              className="h-4 border-status-needs-input/40 bg-status-needs-input/10 px-1.5 py-0 text-[9px] font-normal text-status-needs-input-foreground"
            >
              needs input
            </Badge>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {sessionRunning && activeSession ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[10px]"
              disabled={loading}
              onClick={() => void handleStopOne(activeSession.id)}
            >
              Stop
            </Button>
          ) : null}
          <div
            ref={splitAnchorRef}
            className="flex shrink-0 overflow-hidden rounded-md border border-input"
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 min-w-0 rounded-none border-0 px-2 text-[10px]"
              disabled={loading || !planningApi}
              onClick={() => void handleStart()}
              aria-label="Start new planning session"
              title={`Start session · ${AGENTS.find((a) => a.id === selectedAgent)?.label ?? selectedAgent} · ${modelSummary}`}
            >
              <span className="truncate">Add session</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 w-7 shrink-0 rounded-none border-0 border-l border-input px-0"
              disabled={loading || !planningApi}
              onClick={() => setPrefsOpen((o) => !o)}
              aria-label="Choose agent and model for the next session"
              aria-expanded={prefsOpen}
              aria-haspopup="dialog"
            >
              <ChevronDown data-icon="inline-start" aria-hidden />
            </Button>
          </div>
          {prefsMenu}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={onClose}
            aria-label="Close planning panel"
          >
            <X data-icon="inline-start" aria-hidden />
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
        {sessions.map((s, i) => {
          const sel = s.id === activeSessionId;
          const running = s.status === 'running';
          const resumable = isPlanningSessionResumable(s);
          return (
            <div
              key={s.id}
              className={cn(
                'flex shrink-0 items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px]',
                sel
                  ? 'border-status-success/40 bg-status-success/10 text-status-success-foreground'
                  : 'border-border bg-muted/50 text-muted-foreground',
              )}
            >
              <button
                type="button"
                className="flex max-w-[11rem] items-center gap-1 truncate"
                onClick={() => onActiveSessionChange(s.id)}
                title={planningTabLabel(s, i)}
              >
                <span
                  className={cn(
                    'inline-block size-1.5 shrink-0 rounded-full',
                    running
                      ? 'bg-status-success'
                      : resumable
                        ? 'bg-status-needs-input'
                        : 'bg-muted-foreground/60',
                  )}
                  aria-hidden
                />
                <span className="truncate">{planningTabLabel(s, i)}</span>
              </button>
              {onOpenInMainTab ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5 shrink-0"
                  aria-label="Open planning session in a new tab"
                  title="Open in new tab"
                  onClick={() => onOpenInMainTab(s.id)}
                >
                  <ExternalLink data-icon="inline-start" aria-hidden />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-5 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Close ${planningTabLabel(s, i)}`}
                title={
                  resumable
                    ? planningResumeDismissTitle()
                    : running
                      ? 'Close tab and stop session'
                      : 'Close tab'
                }
                onClick={() => void handleStopOne(s.id)}
              >
                <X data-icon="inline-start" aria-hidden />
              </Button>
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[10px] text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col bg-status-terminal">
        {!planningApi ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-status-terminal-foreground/70">Planning assistant unavailable</p>
            <p className="text-[10px] leading-relaxed text-status-terminal-foreground/50">
              This build does not expose planning IPC yet. Sessions will work once
              the main process and preload wire up{' '}
              <span className="font-mono text-status-terminal-foreground/60">electronAPI.planning</span>
              .
            </p>
          </div>
        ) : activeSession && activeWarmTerminal ? (
          <div className="relative min-h-0 flex-1">
            {sessions
              .filter((s) => planningSessionHasWarmTerminal(s))
              .map((s) => (
                <PlanningTerminalPane
                  key={s.id}
                  session={s}
                  visible={s.id === activeSession.id}
                  layout={layout}
                  needsInput={s.id === activeSession.id && needsInput}
                  onDataChunk={appendOutputAndDetectNeedsInput}
                />
              ))}
            {activeResumable && !sessionRunning ? (
              <div className="absolute inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 px-3 py-2.5 backdrop-blur-sm">
                <p className="mb-0.5 text-center text-xs text-card-foreground">
                  {planningResumeStateHeading(activeSession)}
                </p>
                <p className="mb-2 text-center text-[10px] leading-relaxed text-muted-foreground">
                  {planningResumeStateDetail(activeSession)}
                  {resumableCount > 1
                    ? ` ${resumableCount} sessions can be resumed — switch tabs to pick another.`
                    : null}
                </p>
                {resumeActions}
              </div>
            ) : null}
          </div>
        ) : activeSession && activeResumable ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-card px-4 text-center">
            <p className="text-xs text-card-foreground">{planningResumeStateHeading(activeSession)}</p>
            <p className="max-w-sm text-[10px] leading-relaxed text-muted-foreground">
              {planningResumeStateDetail(activeSession)}
              {resumableCount > 1
                ? ` ${resumableCount} sessions can be resumed — switch tabs to pick another.`
                : null}
            </p>
            {resumeActions}
          </div>
        ) : activeSession ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-card px-4 text-center">
            <p className="text-xs text-muted-foreground">This planning session has ended</p>
            <p className="text-[10px] text-muted-foreground/80">
              Close the tab or start another session from the header.
            </p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-card px-4 text-center">
            <p className="text-xs text-muted-foreground">Select a session or start a new one</p>
            <p className="text-[10px] leading-relaxed text-muted-foreground/80">
              {resumableCount > 0
                ? `${resumableCount} session${resumableCount === 1 ? '' : 's'} can be resumed — pick a tab above.`
                : 'Multiple assistants can run at once — switch tabs without stopping others.'}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={loading}
              onClick={() => void handleStart()}
              className="mt-2 bg-status-success text-status-success-foreground hover:bg-status-success/90"
            >
              {loading ? 'Starting…' : 'Start session'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
