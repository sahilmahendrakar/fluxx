import { ReactNode } from 'react';
import type { Project } from '../types';
import { AppUpdateAffordance } from './AppUpdateAffordance';
import { Sidebar } from './Sidebar';
import { useAppUpdates } from '../renderer/useAppUpdates';
import type { PlanningDocFileEntry, PlanningDocsCloudListMeta } from '../planningDocs/types';
import type { PlanningDocsFirestoreStreamState } from '../renderer/planningDocs/usePlanningDocsFirestoreSync';
import type { SidebarSessionLayout } from '../sidebarSessionGroups';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PanelLeftOpen } from 'lucide-react';

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
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
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
      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {collapsed ? (
          <div className="pointer-events-none absolute bottom-3 left-3 z-40">
            <div className="pointer-events-auto max-w-[min(220px,calc(100vw-1.5rem))]">
              <AppUpdateAffordance {...appUpdates} />
            </div>
          </div>
        ) : null}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onExpand}
                aria-label="Expand sidebar"
                className={cn(
                  'absolute left-2 top-2 z-30 size-8 border-border/80 bg-background/90 shadow-sm backdrop-blur',
                )}
              >
                <PanelLeftOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Expand sidebar</TooltipContent>
          </Tooltip>
        ) : null}
        {children}
      </main>
    </div>
  );
}
