import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, Shell } from '../types';
import Terminal, { type TerminalHandle } from './Terminal';

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

interface SessionTerminalViewProps {
  session: Session;
}

type PaneId = 'agent' | `shell:${string}`;

function AgentPane({ session, visible }: { session: Session; visible: boolean }) {
  const terminalRef = useRef<TerminalHandle | null>(null);
  const running = session.status === 'running';

  useEffect(() => {
    if (!running) return;
    const unsub = window.electronAPI.sessions.onData(session.id, (data) => {
      terminalRef.current?.write(data);
    });
    return () => {
      unsub();
    };
  }, [session.id, running]);

  const handleData = (data: string) => {
    if (running) window.electronAPI.sessions.write(session.id, data);
  };
  const handleResize = (cols: number, rows: number) => {
    if (running) window.electronAPI.sessions.resize(session.id, cols, rows);
  };

  return (
    <div className={['h-full w-full', visible ? 'block' : 'hidden'].join(' ')}>
      {running ? (
        <Terminal
          ref={terminalRef}
          sessionId={session.id}
          onData={handleData}
          onResize={handleResize}
        />
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

  useEffect(() => {
    if (!running) return;
    const unsub = window.electronAPI.shells.onData(shell.id, (data) => {
      terminalRef.current?.write(data);
    });
    return () => {
      unsub();
    };
  }, [shell.id, running]);

  const handleData = (data: string) => {
    if (running) window.electronAPI.shells.write(shell.id, data);
  };
  const handleResize = (cols: number, rows: number) => {
    if (running) window.electronAPI.shells.resize(shell.id, cols, rows);
  };

  return (
    <div className={['h-full w-full', visible ? 'block' : 'hidden'].join(' ')}>
      {running ? (
        <Terminal
          ref={terminalRef}
          sessionId={shell.id}
          onData={handleData}
          onResize={handleResize}
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

export function SessionTerminalView({ session }: SessionTerminalViewProps) {
  const [shells, setShells] = useState<Shell[]>([]);
  const [activePane, setActivePane] = useState<PaneId>('agent');
  const running = session.status === 'running';

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

  const handleOpenShell = useCallback(async () => {
    if (!running) return;
    const shell = await window.electronAPI.shells.open(session.id);
    setShells((prev) => [...prev, shell]);
    setActivePane(`shell:${shell.id}`);
  }, [running, session.id]);

  const handleCloseShell = useCallback(
    async (shellId: string) => {
      await window.electronAPI.shells.close(shellId);
      setShells((prev) => prev.filter((s) => s.id !== shellId));
      setActivePane((prev) => (prev === `shell:${shellId}` ? 'agent' : prev));
    },
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.06] bg-[#0a0a0c] px-3 py-1">
        <PaneTab
          label="Agent"
          active={activePane === 'agent'}
          onClick={() => setActivePane('agent')}
          icon={<BotIcon className="shrink-0 opacity-80" />}
        />
        {shells.map((shell, idx) => (
          <PaneTab
            key={shell.id}
            label={`Terminal ${idx + 1}`}
            active={activePane === `shell:${shell.id}`}
            onClick={() => setActivePane(`shell:${shell.id}`)}
            onClose={() => void handleCloseShell(shell.id)}
            status={shell.status}
          />
        ))}
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
      </div>
      <div className="min-h-0 flex-1 p-3">
        <AgentPane session={session} visible={activePane === 'agent'} />
        {shells.map((shell) => (
          <ShellPane
            key={shell.id}
            shell={shell}
            visible={activePane === `shell:${shell.id}`}
          />
        ))}
      </div>
    </div>
  );
}
