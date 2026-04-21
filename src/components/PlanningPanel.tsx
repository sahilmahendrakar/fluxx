import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AGENTS, type Agent, type PlanningSession, type Project } from '../types';
import Terminal, { type TerminalHandle } from './Terminal';

interface PlanningPanelProps {
  project: Project;
  onClose: () => void;
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

export function PlanningPanel({ project, onClose }: PlanningPanelProps) {
  const planningApi = window.electronAPI.planning;

  const [planningSession, setPlanningSession] = useState<PlanningSession | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsInput, setNeedsInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<Agent>(() =>
    project.kind === 'local' ? project.planningAgent : 'claude-code',
  );
  const terminalRef = useRef<TerminalHandle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputBufferRef = useRef('');
  const planningSessionRef = useRef<PlanningSession | null>(null);
  planningSessionRef.current = planningSession;

  useEffect(() => {
    setSelectedAgent(
      project.kind === 'local' ? project.planningAgent : 'claude-code',
    );
  }, [project]);

  useEffect(() => {
    setPlanningSession(null);
    setError(null);
    setNeedsInput(false);
    outputBufferRef.current = '';
    if (!planningApi) return;
    let cancelled = false;
    void planningApi.get().then((existing) => {
      if (cancelled) return;
      if (existing && existing.status === 'running') {
        setPlanningSession(existing);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project.id, planningApi]);

  useEffect(() => {
    if (!planningApi) return;
    return planningApi.onExit((exited) => {
      setPlanningSession((prev) => (prev?.id === exited.id ? null : prev));
      setNeedsInput(false);
      outputBufferRef.current = '';
    });
  }, [planningApi]);

  const appendOutputAndDetectNeedsInput = useCallback((chunk: string) => {
    outputBufferRef.current = (
      outputBufferRef.current + chunk
    ).slice(-OUTPUT_TAIL_MAX);
    if (planningSessionRef.current?.status === 'running') {
      setNeedsInput(tailNeedsInputHint(outputBufferRef.current));
    }
  }, []);

  useEffect(() => {
    if (
      !planningApi ||
      !planningSession ||
      planningSession.status !== 'running'
    ) {
      return;
    }
    const unsub = planningApi.onData((data) => {
      terminalRef.current?.write(data);
      appendOutputAndDetectNeedsInput(data);
    });
    return () => {
      unsub();
    };
  }, [
    planningApi,
    planningSession?.id,
    planningSession?.status,
    appendOutputAndDetectNeedsInput,
  ]);

  useEffect(() => {
    if (needsInput) inputRef.current?.focus();
  }, [needsInput]);

  const handleStart = async () => {
    if (!planningApi) {
      setError('Planning assistant is not available in this build.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await planningApi.start();
      if (result && typeof result === 'object' && 'error' in result) {
        const err = result as { error: string; message?: string };
        setError(err.message ?? err.error ?? 'Failed to start');
        return;
      }
      setPlanningSession(result);
    } catch {
      setError('Failed to start session');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = () => {
    const s = planningSessionRef.current;
    if (!planningApi || !s || s.status !== 'running' || !inputValue.trim()) {
      return;
    }
    const line = inputValue;
    planningApi.write(`${line}\n`);
    setInputValue('');
    setNeedsInput(false);
    terminalRef.current?.write(`${line}\r\n`);
  };

  const handleTerminalData = (data: string) => {
    if (
      planningApi &&
      planningSessionRef.current?.status === 'running'
    ) {
      planningApi.write(data);
    }
  };

  const sessionRunning = planningSession?.status === 'running';
  const agentSelectValue =
    sessionRunning && planningSession
      ? planningSession.agent
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
          <select
            aria-label="Planning agent"
            title={
              sessionRunning
                ? 'Agent for this session'
                : 'Shown for reference; the started session uses the project planning agent (local projects) or Claude Code (cloud).'
            }
            disabled={sessionRunning}
            value={agentSelectValue}
            onChange={(e) => setSelectedAgent(e.target.value as Agent)}
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
        ) : sessionRunning && planningSession ? (
          <div className="flex min-h-0 flex-1 flex-col px-3 py-2">
            <div className="min-h-0 flex-1 overflow-hidden">
              <Terminal
                ref={terminalRef}
                sessionId={planningSession.id}
                onData={handleTerminalData}
                onResize={(cols, rows) => planningApi.resize(cols, rows)}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-gray-600">No active planning session</p>
            <p className="text-[10px] leading-relaxed text-gray-700">
              Start a session to plan features, create tasks, and maintain project
              docs
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

      <div className="flex h-[52px] shrink-0 items-center gap-2 border-t border-gray-800 px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={
            planningSession ? 'Message the planning assistant…' : 'Start a session first'
          }
          disabled={!planningApi || !planningSession}
          className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1.5 font-mono text-xs text-gray-200 placeholder-gray-600 focus:border-gray-600 focus:outline-none disabled:opacity-40"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!planningApi || !planningSession || !inputValue.trim()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-green-800 bg-green-900 transition-colors hover:bg-green-800 disabled:opacity-30"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path
              d="M5 8V2M2 5l3-3 3 3"
              stroke="#86efac"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
