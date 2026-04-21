import { ReactNode, useEffect, useState } from 'react';
import type { Project } from '../types';
import { Sidebar } from './Sidebar';
import type { SessionTabMeta } from './TabBar';

const SIDEBAR_COLLAPSED_KEY = 'flux.sidebarCollapsed';

interface AppShellProps {
  children: ReactNode;
  project: Project;
  onClearProject: () => void;
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  sessions: SessionTabMeta[];
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteWorkspace: (sessionId: string) => void;
}

function SidebarExpandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 2.5v11" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 6l2.5 2L8 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppShell({
  children,
  project,
  onClearProject,
  activeTabId,
  onSelectTab,
  sessions,
  onOpenSession,
  onArchiveSession,
  onDeleteWorkspace,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#09090b] text-zinc-100">
      {collapsed ? null : (
        <Sidebar
          project={project}
          activeTabId={activeTabId}
          onSelectTab={onSelectTab}
          sessions={sessions}
          onOpenSession={onOpenSession}
          onArchiveSession={onArchiveSession}
          onDeleteWorkspace={onDeleteWorkspace}
          onClearProject={onClearProject}
          onCollapse={() => setCollapsed(true)}
        />
      )}
      <main className="relative flex min-h-0 flex-1 flex flex-col overflow-hidden">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="absolute left-2 top-2 z-30 rounded-md border border-white/[0.06] bg-[#0c0c0e]/80 p-1 text-zinc-500 shadow-sm backdrop-blur transition hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <SidebarExpandIcon />
          </button>
        ) : null}
        {children}
      </main>
    </div>
  );
}
