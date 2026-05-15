import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent } from '../types';
import { AGENTS } from '../types';

function agentLabel(agent: Agent): string {
  return AGENTS.find((a) => a.id === agent)?.label ?? agent;
}

/**
 * Subscribes to daemon `auto-responded` IPC for one session and returns a short
 * transient message for inline UI (clears after a few seconds).
 */
export function useTrustAutorespondNotice(
  kind: 'session' | 'planning',
  sessionId: string | null | undefined,
  running: boolean,
): string | null {
  const [note, setNote] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((agent: Agent) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setNote(`Flux auto-accepted ${agentLabel(agent)}'s trust prompt.`);
    timerRef.current = setTimeout(() => {
      setNote(null);
      timerRef.current = null;
    }, 8000);
  }, []);

  useEffect(() => {
    if (!running || !sessionId) {
      setNote(null);
      return;
    }
    const api =
      kind === 'session'
        ? window.electronAPI.sessions.onTrustPromptAutoresponded
        : window.electronAPI.planning.onTrustPromptAutoresponded;
    if (!api) {
      return () => {};
    }
    return api(sessionId, (payload) => {
      show(payload.agent);
    });
  }, [kind, sessionId, running, show]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return note;
}
