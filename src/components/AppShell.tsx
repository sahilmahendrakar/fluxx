import { ReactNode } from 'react';
import type { Project } from '../types';
import { Sidebar, WorkspaceNavView } from './Sidebar';

interface AppShellProps {
  children: ReactNode;
  project: Project;
  onClearProject: () => void;
  workspaceView: WorkspaceNavView;
  onWorkspaceViewChange: (view: WorkspaceNavView) => void;
}

export function AppShell({
  children,
  project,
  onClearProject,
  workspaceView,
  onWorkspaceViewChange,
}: AppShellProps) {
  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#09090b] text-zinc-100">
      <Sidebar
        project={project}
        workspaceView={workspaceView}
        onWorkspaceViewChange={onWorkspaceViewChange}
        onClearProject={onClearProject}
      />
      <main className="flex min-h-0 flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
