import { useEffect, useRef, useState } from 'react';
import type { Session } from '../types';
import Terminal, { type TerminalHandle } from './Terminal';

interface TerminalWindowPageProps {
  sessionId: string;
}

export default function TerminalWindowPage({ sessionId }: TerminalWindowPageProps) {
  const isMac = window.electronAPI.platform === 'darwin';
  const terminalRef = useRef<TerminalHandle | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [taskTitle, setTaskTitle] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.electronAPI.sessions.getAll(),
      window.electronAPI.tasks.getAll(),
    ]).then(([sessions, tasks]) => {
      if (cancelled) return;
      const s = sessions.find((x) => x.id === sessionId) ?? null;
      setSession(s);
      if (s) {
        const t = tasks.find((x) => x.id === s.taskId);
        setTaskTitle(t?.title ?? s.taskId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!session || session.status !== 'running') return;
    const unsub = window.electronAPI.sessions.onData(session.id, (data) => {
      terminalRef.current?.write(data);
    });
    const unsubExit = window.electronAPI.sessions.onExit((exitedSession) => {
      if (exitedSession.id === session.id) {
        setSession((prev) => (prev ? { ...prev, status: exitedSession.status } : null));
      }
    });
    return () => {
      unsub();
      unsubExit();
    };
  }, [session?.id, session?.status]);

  const handleTerminalData = (data: string) => {
    if (session?.status === 'running') {
      window.electronAPI.sessions.write(session.id, data);
    }
  };

  const handleTerminalResize = (cols: number, rows: number) => {
    if (session?.status === 'running') {
      window.electronAPI.sessions.resize(session.id, cols, rows);
    }
  };

  const running = session?.status === 'running';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#09090b] text-zinc-100">
      {isMac ? (
        <div className="app-window-drag flex h-10 shrink-0 items-center border-b border-white/[0.06] bg-[#09090b] px-3">
          <span className="app-window-no-drag truncate text-[13px] text-zinc-400">
            {taskTitle || 'Session terminal'}
          </span>
        </div>
      ) : (
        <div className="flex shrink-0 border-b border-white/[0.06] px-3 py-2">
          <span className="truncate text-[13px] text-zinc-400">
            {taskTitle || 'Session terminal'}
          </span>
        </div>
      )}
      <div className="app-window-no-drag min-h-0 flex-1 p-2">
        {running ? (
          <Terminal
            ref={terminalRef}
            sessionId={session.id}
            onData={handleTerminalData}
            onResize={handleTerminalResize}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-[13px] text-zinc-500">
            {session == null
              ? 'Loading session…'
              : 'This session is no longer running.'}
          </div>
        )}
      </div>
    </div>
  );
}
