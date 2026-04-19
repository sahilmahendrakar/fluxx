import { ReactNode } from 'react';
import { Sidebar, WorkspaceNavView } from './Sidebar';

interface AppShellProps {
  children: ReactNode;
  workspaceView: WorkspaceNavView;
  onWorkspaceViewChange: (view: WorkspaceNavView) => void;
}

export function AppShell({ children, workspaceView, onWorkspaceViewChange }: AppShellProps) {
  return (
    <div className="flex h-full min-h-0 w-full bg-gray-950 text-white overflow-hidden">
      <Sidebar workspaceView={workspaceView} onWorkspaceViewChange={onWorkspaceViewChange} />
      <main className="flex min-h-0 flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
