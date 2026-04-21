import { ReactNode } from 'react';
import type { Project } from '../types';
import {
  Sidebar,
  WorkspaceNavView,
  type PlanningDocFile,
} from './Sidebar';

interface AppShellProps {
  children: ReactNode;
  project: Project;
  onClearProject: () => void;
  workspaceView: WorkspaceNavView;
  onWorkspaceViewChange: (view: WorkspaceNavView) => void;
  onPlanNavClick: () => void;
  onDocsNavClick: () => void;
  docsSidebarExpanded: boolean;
  onDocsSidebarExpandToggle: () => void;
  planningDocFiles: PlanningDocFile[];
  planningDocsListLoading: boolean;
  planningDocsListError: string | null;
  selectedPlanningDocPath: string | null;
  onSelectPlanningDoc: (relativePath: string) => void;
  planPanelOpen: boolean;
}

export function AppShell({
  children,
  project,
  onClearProject,
  workspaceView,
  onWorkspaceViewChange,
  onPlanNavClick,
  onDocsNavClick,
  docsSidebarExpanded,
  onDocsSidebarExpandToggle,
  planningDocFiles,
  planningDocsListLoading,
  planningDocsListError,
  selectedPlanningDocPath,
  onSelectPlanningDoc,
  planPanelOpen,
}: AppShellProps) {
  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#09090b] text-zinc-100">
      <Sidebar
        project={project}
        workspaceView={workspaceView}
        onWorkspaceViewChange={onWorkspaceViewChange}
        onPlanNavClick={onPlanNavClick}
        onDocsNavClick={onDocsNavClick}
        docsSidebarExpanded={docsSidebarExpanded}
        onDocsSidebarExpandToggle={onDocsSidebarExpandToggle}
        planningDocFiles={planningDocFiles}
        planningDocsListLoading={planningDocsListLoading}
        planningDocsListError={planningDocsListError}
        selectedPlanningDocPath={selectedPlanningDocPath}
        onSelectPlanningDoc={onSelectPlanningDoc}
        planPanelOpen={planPanelOpen}
        onClearProject={onClearProject}
      />
      <main className="flex min-h-0 flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
