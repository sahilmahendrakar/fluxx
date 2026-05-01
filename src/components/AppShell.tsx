import { ReactNode } from 'react';
import type { Project } from '../types';
import { Sidebar, type PlanningDocFile } from './Sidebar';
import type { SessionTabMeta } from './TabBar';

interface AppShellProps {
  children: ReactNode;
  project: Project;
  onClearProject: () => void;
  activeTabId: string;
  settingsRouteActive: boolean;
  onSelectTab: (tabId: string) => void;
  onOpenSettings: () => void;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onPlanNavClick: () => void;
  onDocsNavClick: () => void;
  docsSidebarExpanded: boolean;
  onDocsSidebarExpandToggle: () => void;
  planningDocFiles: PlanningDocFile[];
  planningDocsListLoading: boolean;
  planningDocsListError: string | null;
  selectedPlanningDocPath: string | null;
  onSelectPlanningDoc: (relativePath: string) => void;
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
      <rect x="1.5" y="2.5" width={13} height={11} rx="1.5" stroke="currentColor" strokeWidth="1.2" />
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
  settingsRouteActive,
  onSelectTab,
  onOpenSettings,
  collapsed,
  onCollapse,
  onExpand,
  onPlanNavClick,
  onDocsNavClick,
  docsSidebarExpanded,
  onDocsSidebarExpandToggle,
  planningDocFiles,
  planningDocsListLoading,
  planningDocsListError,
  selectedPlanningDocPath,
  onSelectPlanningDoc,
  sessions,
  onOpenSession,
  onArchiveSession,
  onDeleteWorkspace,
}: AppShellProps) {
  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#09090b] text-zinc-100">
      {collapsed ? null : (
        <Sidebar
          project={project}
          activeTabId={activeTabId}
          settingsRouteActive={settingsRouteActive}
          onSelectTab={onSelectTab}
          onOpenSettings={onOpenSettings}
          onPlanNavClick={onPlanNavClick}
          onDocsNavClick={onDocsNavClick}
          docsSidebarExpanded={docsSidebarExpanded}
          onDocsSidebarExpandToggle={onDocsSidebarExpandToggle}
          planningDocFiles={planningDocFiles}
          planningDocsListLoading={planningDocsListLoading}
          planningDocsListError={planningDocsListError}
          selectedPlanningDocPath={selectedPlanningDocPath}
          onSelectPlanningDoc={onSelectPlanningDoc}
          sessions={sessions}
          onOpenSession={onOpenSession}
          onArchiveSession={onArchiveSession}
          onDeleteWorkspace={onDeleteWorkspace}
          onClearProject={onClearProject}
          onCollapse={onCollapse}
        />
      )}
      <main className="relative flex min-h-0 flex-1 flex flex-col overflow-hidden">
        {collapsed ? (
          <button
            type="button"
            onClick={onExpand}
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
