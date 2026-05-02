import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ExternalLink } from 'lucide-react';
import type { AgentModelUiKind } from '../agentModelUi';
import {
  appendAgentModelExtra,
  choicesForPicker,
  labelForModelId,
} from '../agentModelUi';
import {
  migrateLegacyPlanningModelsIfNeeded,
  readPlanningModelsForProject,
} from '../planningSessionModelPrefs';
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

const prefsMenuItemClass =
  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-flux-fg transition hover:bg-flux-hover/8';

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

  useTerminalPtyStream({
    terminalRef,
    id: session.id,
    enabled: Boolean(planningApi && running),
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
    invalidateAttachCache: () => invalidatePlanningAttachCache(session.id),
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
  const [planningYolo, setPlanningYolo] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [extrasGen, setExtrasGen] = useState(0);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [addModelId, setAddModelId] = useState('');
  const [addModelLabel, setAddModelLabel] = useState('');
  const [addModelError, setAddModelError] = useState<string | null>(null);

  const outputBufferRef = useRef('');
  const activeSessionRef = useRef<PlanningSession | null>(null);
  const splitAnchorRef = useRef<HTMLDivElement>(null);
  const prefsDropdownRef = useRef<HTMLDivElement>(null);
  const [prefsPos, setPrefsPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 240,
  });

  const activeSession =
    activeSessionId == null
      ? null
      : (sessions.find((s) => s.id === activeSessionId) ?? null);
  activeSessionRef.current = activeSession;

  const modelKindForAgent = (a: Agent): AgentModelUiKind | null =>
    a === 'cursor' ? 'cursor' : a === 'claude-code' ? 'claude-code' : null;

  const activeModelId =
    selectedAgent === 'cursor'
      ? cursorModelId
      : selectedAgent === 'claude-code'
        ? claudeModelId
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
      setClaudeModelId(claude);
      setCursorModelId(cursor);
      setPlanningYolo(project.planningAgentYolo === true);
      setError(null);
      setNeedsInput(false);
      outputBufferRef.current = '';
      setPrefsOpen(false);
      setAddModelOpen(false);
      setAddModelId('');
      setAddModelLabel('');
      setAddModelError(null);
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

  useLayoutEffect(() => {
    if (!prefsOpen || !splitAnchorRef.current) return;
    const rect = splitAnchorRef.current.getBoundingClientRect();
    setPrefsPos({
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - 260),
      width: 260,
    });
  }, [prefsOpen]);

  useEffect(() => {
    if (!prefsOpen) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const anchor = splitAnchorRef.current;
      const menu = prefsDropdownRef.current;
      const t = e.target as Node;
      if (anchor && !anchor.contains(t) && (!menu || !menu.contains(t))) {
        setPrefsOpen(false);
        setAddModelOpen(false);
        setAddModelId('');
        setAddModelLabel('');
        setAddModelError(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [prefsOpen]);

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

  const handleAgentPick = (next: Agent) => {
    setSelectedAgent(next);
    void (async () => {
      await persistPlanningAgent(next);
    })();
  };

  const handleModelPick = (kind: AgentModelUiKind, id: string) => {
    if (kind === 'claude-code') {
      setClaudeModelId(id);
    } else {
      const norm = id.trim() || DEFAULT_CURSOR_AGENT_MODEL;
      setCursorModelId(norm);
    }
    void (async () => {
      const patch =
        kind === 'claude-code'
          ? { planningModels: { 'claude-code': id } as const }
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
    setPrefsOpen(false);
    setAddModelOpen(false);
    setAddModelId('');
    setAddModelLabel('');
    setAddModelError(null);
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

  const handleAddCustomModel = (kind: AgentModelUiKind) => {
    setAddModelError(null);
    const id = addModelId.trim();
    if (!id) {
      setAddModelError('Enter a model id.');
      return;
    }
    const label = addModelLabel.trim() || id;
    if (!appendAgentModelExtra(kind, { id, label })) {
      setAddModelError('That id is already in the list (preset or added earlier).');
      return;
    }
    setExtrasGen((g) => g + 1);
    handleModelPick(kind, id);
  };

  const buildStartPayload = ():
    | Agent
    | { agent: Agent; agentModel?: string; agentYolo?: boolean } => {
    if (selectedAgent === 'codex') {
      return { agent: selectedAgent, agentYolo: planningYolo };
    }
    if (selectedAgent === 'cursor') {
      return {
        agent: selectedAgent,
        agentModel: cursorModelId.trim() || DEFAULT_CURSOR_AGENT_MODEL,
        agentYolo: planningYolo,
      };
    }
    return {
      agent: selectedAgent,
      agentModel: claudeModelId.trim(),
      agentYolo: planningYolo,
    };
  };

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
  const mk = modelKindForAgent(selectedAgent);
  // `extrasGen` bumps after "Add model" so lists match `agentModelUi` / task flows.
  void extrasGen;
  const modelChoices = mk ? choicesForPicker(mk, activeModelId) : [];
  const modelSummary =
    mk === 'claude-code' && !claudeModelId.trim()
      ? 'Default'
      : mk
        ? labelForModelId(mk, activeModelId)
        : '—';

  const prefsMenu =
    prefsOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={prefsDropdownRef}
            className="fixed z-[200] max-h-[min(22rem,calc(100vh-5rem))] overflow-y-auto rounded-md border border-flux-border/15 bg-flux-elevated py-1 shadow-xl ring-1 ring-flux-border/8"
            style={{
              top: prefsPos.top,
              left: prefsPos.left,
              width: prefsPos.width,
            }}
            role="dialog"
            aria-label="Next planning session"
          >
            <div className="border-b border-flux-border/10 px-2.5 py-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-flux-fg-muted">
                Agent
              </p>
              <div className="mt-1 flex flex-col gap-0.5">
                {AGENTS.map((a) => {
                  const sel = selectedAgent === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`${prefsMenuItemClass} rounded ${sel ? 'bg-flux-selected/10' : ''}`}
                      onClick={() => handleAgentPick(a.id)}
                    >
                      <span className="font-medium text-flux-fg">{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="px-2.5 py-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-flux-fg-muted">
                Model
              </p>
              {mk ? (
                <>
                  {mk === 'claude-code' ? (
                    <button
                      type="button"
                      className={`${prefsMenuItemClass} mt-1 rounded ${!claudeModelId.trim() ? 'bg-flux-selected/10' : ''}`}
                      onClick={() => handleModelPick('claude-code', '')}
                    >
                      <span className="font-medium text-flux-fg">Default</span>
                      <span className="ml-auto shrink-0 text-[10px] text-flux-fg-muted">CLI</span>
                    </button>
                  ) : null}
                  {modelChoices.map((p) => {
                    const selected =
                      mk === 'claude-code'
                        ? claudeModelId.trim() === p.id
                        : (cursorModelId.trim() || DEFAULT_CURSOR_AGENT_MODEL) === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`${prefsMenuItemClass} rounded ${selected ? 'bg-flux-selected/10' : ''}`}
                        onClick={() => handleModelPick(mk, p.id)}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-flux-fg">
                          {p.label}
                        </span>
                        <span className="shrink-0 font-mono text-[9px] text-flux-fg-muted">{p.id}</span>
                      </button>
                    );
                  })}
                  <div className="mx-0.5 my-1 border-t border-flux-border/10 pt-1">
                    {!addModelOpen ? (
                      <button
                        type="button"
                        className={`${prefsMenuItemClass} text-flux-fg-muted`}
                        onClick={() => {
                          setAddModelOpen(true);
                          setAddModelError(null);
                        }}
                      >
                        Add model…
                      </button>
                    ) : (
                      <div className="space-y-1.5 px-1 py-1">
                        <p className="text-[10px] leading-snug text-flux-fg-muted">
                          Model id your CLI accepts (same list as task sessions).
                        </p>
                        <input
                          value={addModelId}
                          onChange={(e) => setAddModelId(e.target.value)}
                          placeholder="Model id"
                          className="w-full rounded border border-flux-border/15 bg-flux-surface px-2 py-1 font-mono text-[10px] text-flux-fg outline-none focus-visible:border-flux-border/30"
                        />
                        <input
                          value={addModelLabel}
                          onChange={(e) => setAddModelLabel(e.target.value)}
                          placeholder="Display name (optional)"
                          className="w-full rounded border border-flux-border/15 bg-flux-surface px-2 py-1 text-[10px] text-flux-fg outline-none focus-visible:border-flux-border/30"
                        />
                        {addModelError ? (
                          <p className="text-[10px] text-flux-danger">{addModelError}</p>
                        ) : null}
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => handleAddCustomModel(mk)}
                            className="rounded border border-flux-success/30 bg-flux-success/10 px-2 py-0.5 text-[10px] font-medium text-flux-success"
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddModelOpen(false);
                              setAddModelId('');
                              setAddModelLabel('');
                              setAddModelError(null);
                            }}
                            className="rounded px-2 py-0.5 text-[10px] text-flux-fg-muted hover:bg-flux-hover/8"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-[10px] leading-snug text-flux-fg-muted">
                  Codex uses its default model for planning in this version.
                </p>
              )}
            </div>
            <div className="border-t border-flux-border/10 px-2.5 py-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-flux-fg-muted">
                Skip permission prompts
              </p>
              <button
                type="button"
                className={`${prefsMenuItemClass} mt-1 w-full justify-between rounded ${planningYolo ? 'bg-flux-selected/10' : ''}`}
                onClick={() => void persistPlanningYolo(!planningYolo)}
              >
                <span className="font-medium text-flux-fg">YOLO</span>
                <span className="text-[10px] text-flux-fg-muted">{planningYolo ? 'On' : 'Off'}</span>
              </button>
              <p className="mt-1 text-[9px] leading-snug text-flux-fg-subtle">
                Cursor adds <span className="font-mono">--yolo</span>; Claude adds{' '}
                <span className="font-mono">--dangerously-skip-permissions</span>.
              </p>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-flux-border/10 bg-flux-canvas">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-flux-border/10 bg-flux-elevated px-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              sessionRunning ? 'bg-flux-success' : 'bg-flux-fg-subtle'
            }`}
            aria-hidden
          />
          <span className="truncate text-xs font-medium text-flux-fg">
            Planning assistant
          </span>
          {sessionRunning && needsInput ? (
            <span className="shrink-0 rounded-full border border-flux-warning/35 bg-flux-warning/10 px-1.5 py-0.5 text-[9px] text-flux-warning">
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
              className="rounded-md border border-flux-border/15 bg-flux-surface px-2 py-1 text-[10px] font-medium text-flux-fg transition hover:bg-flux-hover/10 disabled:opacity-50"
            >
              Stop
            </button>
          ) : null}
          <div ref={splitAnchorRef} className="flex shrink-0 overflow-hidden rounded-md border border-flux-border/15">
            <button
              type="button"
              disabled={loading || !planningApi}
              onClick={() => void handleStart()}
              className="flex min-w-0 items-center gap-1 bg-flux-surface px-2 py-1 text-[10px] font-medium text-flux-fg transition hover:bg-flux-hover/10 disabled:opacity-40"
              aria-label="Start new planning session"
              title={`Start session · ${AGENTS.find((a) => a.id === selectedAgent)?.label ?? selectedAgent} · ${modelSummary}`}
            >
              <span className="truncate">Add session</span>
            </button>
            <button
              type="button"
              disabled={loading || !planningApi}
              onClick={() => setPrefsOpen((o) => !o)}
              className="flex w-7 shrink-0 items-center justify-center border-l border-flux-border/15 bg-flux-surface text-flux-fg-muted transition hover:bg-flux-hover/10 hover:text-flux-fg disabled:opacity-40"
              aria-label="Choose agent and model for the next session"
              aria-expanded={prefsOpen}
              aria-haspopup="dialog"
            >
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </button>
          </div>
          {prefsMenu}
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-flux-fg-muted transition hover:bg-flux-hover/10 hover:text-flux-fg"
            aria-label="Close planning panel"
          >
            ×
          </button>
        </div>
      </header>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-flux-border/10 bg-flux-elevated/50 px-2 py-1.5">
        {sessions.map((s, i) => {
          const sel = s.id === activeSessionId;
          const running = s.status === 'running';
          return (
            <div
              key={s.id}
              className={[
                'flex shrink-0 items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px]',
                sel
                  ? 'border-flux-success/35 bg-flux-success/10 text-flux-fg'
                  : 'border-flux-border/10 bg-flux-elevated/80 text-flux-fg-muted',
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
                    running ? 'bg-flux-success' : 'bg-flux-fg-subtle',
                  ].join(' ')}
                  aria-hidden
                />
                <span className="truncate">{planningTabLabel(s, i)}</span>
              </button>
              {onOpenInMainTab ? (
                <button
                  type="button"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-flux-fg-muted hover:bg-flux-hover/10 hover:text-flux-fg"
                  aria-label="Open planning session in a new tab"
                  title="Open in new tab"
                  onClick={() => onOpenInMainTab(s.id)}
                >
                  <ExternalLink className="h-3 w-3" strokeWidth={2} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-flux-fg-muted hover:bg-flux-danger/10 hover:text-flux-danger"
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
      </div>

      {error ? (
        <div className="shrink-0 border-b border-flux-danger/25 bg-flux-danger/10 px-2.5 py-1.5 text-[10px] text-flux-danger">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col bg-flux-canvas">
        {!planningApi ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-flux-fg-muted">Planning assistant unavailable</p>
            <p className="text-[10px] leading-relaxed text-flux-fg-subtle">
              This build does not expose planning IPC yet. Sessions will work once
              the main process and preload wire up{' '}
              <span className="font-mono text-flux-fg-muted">electronAPI.planning</span>
              .
            </p>
          </div>
        ) : sessionRunning && activeSession ? (
          <div className="relative min-h-0 flex-1">
            {sessions
              .filter((s) => s.status === 'running')
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
          </div>
        ) : activeSession && !sessionRunning ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-flux-fg-muted">This planning session has ended</p>
            <p className="text-[10px] text-flux-fg-subtle">
              Close the tab or start another session from the header.
            </p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-flux-fg-muted">Select a session or start a new one</p>
            <p className="text-[10px] leading-relaxed text-flux-fg-subtle">
              Multiple assistants can run at once — switch tabs without stopping others.
            </p>
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleStart()}
              className="mt-2 rounded-md border border-flux-success/30 bg-flux-success/15 px-3 py-1.5 text-xs font-medium text-flux-success transition-colors hover:bg-flux-success/25 disabled:opacity-50"
            >
              {loading ? 'Starting…' : 'Start session'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
