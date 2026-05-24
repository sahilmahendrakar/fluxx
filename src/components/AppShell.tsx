import { ReactNode } from 'react';
import type { Project } from '../types';
import { AppUpdateAffordance } from './AppUpdateAffordance';
import { Sidebar } from './Sidebar';
import { useAppUpdates } from '../renderer/useAppUpdates';
import type { PlanningDocFileEntry, PlanningDocsCloudListMeta } from '../planningDocs/types';
import type { PlanningDocsFirestoreStreamState } from '../renderer/planningDocs/usePlanningDocsFirestoreSync';
import type { SidebarSessionLayout } from '../sidebarSessionGroups';

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
  planningDocFiles: PlanningDocFileEntry[];
  planningDocsCloudListMeta: PlanningDocsCloudListMeta | null;
  planningDocsFirestoreStream: PlanningDocsFirestoreStreamState;
  planningDocsFirebaseConfigured: boolean;
  planningDocsListLoading: boolean;
  planningDocsListError: string | null;
  selectedPlanningDocPath: string | null;
  onSelectPlanningDoc: (relativePath: string) => void;
  sessionLayout: SidebarSessionLayout;
  restoringWorkspaceIds?: ReadonlySet<string>;
  onOpenSession: (sessionId: string) => void;
  onMinimizeSession: (sessionId: string) => void;
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
  planningDocsCloudListMeta,
  planningDocsFirestoreStream,
  planningDocsFirebaseConfigured,
  planningDocsListLoading,
  planningDocsListError,
  selectedPlanningDocPath,
  onSelectPlanningDoc,
  sessionLayout,
  restoringWorkspaceIds,
  onOpenSession,
  onMinimizeSession,
  onDeleteWorkspace,
}: AppShellProps) {
  const appUpdates = useAppUpdates();

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-[#09090b] text-zinc-100">
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
          planningDocsCloudListMeta={planningDocsCloudListMeta}
          planningDocsFirestoreStream={planningDocsFirestoreStream}
          planningDocsFirebaseConfigured={planningDocsFirebaseConfigured}
          planningDocsListLoading={planningDocsListLoading}
          planningDocsListError={planningDocsListError}
          selectedPlanningDocPath={selectedPlanningDocPath}
          onSelectPlanningDoc={onSelectPlanningDoc}
          sessionLayout={sessionLayout}
          restoringWorkspaceIds={restoringWorkspaceIds}
          onOpenSession={onOpenSession}
          onMinimizeSession={onMinimizeSession}
          onDeleteWorkspace={onDeleteWorkspace}
          onClearProject={onClearProject}
          onCollapse={onCollapse}
          updateFooter={<AppUpdateAffordance {...appUpdates} />}
        />
      )}
      <main className="relative flex min-h-0 flex-1 flex flex-col overflow-hidden">
        {collapsed ? (
          <div className="pointer-events-none absolute bottom-3 left-3 z-40">
            <div className="pointer-events-auto max-w-[min(220px,calc(100vw-1.5rem))]">
              <AppUpdateAffordance {...appUpdates} />
            </div>
          </div>
        ) : null}
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
