import type { Session, Task } from '../types';

export interface SessionTabMeta {
  session: Session;
  title: string;
}

interface TabBarProps {
  activeTabId: string;
  openSessions: SessionTabMeta[];
  onSelectTab: (tabId: string) => void;
  onCloseSessionTab: (sessionId: string) => void;
}

export function buildSessionTabs(
  openSessions: Session[],
  tasks: Task[],
): SessionTabMeta[] {
  return openSessions.map((session) => {
    const task = tasks.find((t) => t.id === session.taskId);
    return { session, title: task?.title ?? 'Session' };
  });
}

export function TabBar({
  activeTabId,
  openSessions,
  onSelectTab,
  onCloseSessionTab,
}: TabBarProps) {
  const tabClass = (active: boolean) =>
    [
      'group flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1 text-[13px] transition-colors',
      active
        ? 'bg-white/[0.06] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
        : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-200',
    ].join(' ');

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      <button
        type="button"
        className={tabClass(activeTabId === 'board')}
        onClick={() => onSelectTab('board')}
      >
        <span>Board</span>
      </button>
      {openSessions.length > 0 ? (
        <div className="mx-1 h-4 w-px shrink-0 self-center bg-white/[0.06]" aria-hidden />
      ) : null}
      {openSessions.map(({ session, title }) => {
        const active = activeTabId === session.id;
        const running = session.status === 'running';
        return (
          <div key={session.id} className={tabClass(active)}>
            <button
              type="button"
              onClick={() => onSelectTab(session.id)}
              className="flex min-w-0 items-center gap-1.5"
            >
              <span
                className={[
                  'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                  running ? 'bg-emerald-400' : 'bg-zinc-600',
                ].join(' ')}
                aria-hidden
              />
              <span className="max-w-[180px] truncate">{title}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${title} tab`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseSessionTab(session.id);
              }}
              className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-600 opacity-60 transition hover:bg-white/[0.08] hover:text-zinc-200 hover:opacity-100"
            >
              <span className="text-[13px] leading-none" aria-hidden>
                ×
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
