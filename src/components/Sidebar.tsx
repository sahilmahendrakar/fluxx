import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Folder, FolderGit2, Minus, PanelLeftClose, Trash2 } from 'lucide-react';
import type { Project } from '../types';
import type { SessionTabMeta } from './TabBar';
import { workspaceSessionStatusDotClass } from '../taskStatusDot';
import type { SidebarSessionLayout } from '../sidebarSessionGroups';
import {
  readCollapsedRepoIdsForProject,
  writeCollapsedRepoIdsForProject,
} from '../sidebarRepoSectionCollapse';
import {
  buildPlanningDocsSidebarLayout,
  collectPlanningDocFolderPaths,
  planningDocSidebarFileLabel,
  type PlanningDocsSidebarTreeNode,
} from '../planningDocsSidebarTree';
import {
  defaultCollapsedPlanningDocFolderPaths,
  hasPlanningDocFolderCollapseStateForProject,
  readCollapsedPlanningDocFolderPathsForProject,
  writeCollapsedPlanningDocFolderPathsForProject,
} from '../sidebarPlanningDocFolderCollapse';
import type { PlanningDocFileEntry, PlanningDocsCloudListMeta } from '../planningDocs/types';
import type { PlanningDocsFirestoreStreamState } from '../renderer/planningDocs/usePlanningDocsFirestoreSync';
import { AppearanceToggle } from './AppearanceToggle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  shellDivider,
  shellIconButtonClass,
  shellMutedTextClass,
  shellNavButtonClass,
  shellNavFileRowClass,
  shellNavRowClass,
  shellRadius,
  shellSidebarLabelButton,
} from './shell/shellNavStyles';

function formatPlanningDocShortTime(iso: string | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function PlanningCloudDocsSyncHint({
  meta,
}: {
  meta: PlanningDocsCloudListMeta | null;
}) {
  const t = formatPlanningDocShortTime(meta?.syncStateUpdatedAt);
  if (!t) return null;

  return (
    <p className="mb-1 px-2 py-0.5 text-left text-[10px] leading-snug text-muted-foreground">
      Last sync {t}
    </p>
  );
}

interface SidebarProps {
  project: Project;
  activeTabId: string;
  settingsRouteActive: boolean;
  onSelectTab: (tabId: string) => void;
  onOpenSettings: () => void;
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
  onClearProject: () => void;
  onCollapse: () => void;
  /** Bottom chrome above “Close project” (e.g. app update control). */
  updateFooter?: ReactNode;
}

function BoardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="1.5" y="1.5" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function DocsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M4 2.5h5.5L12.5 5v8.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9 2.5V5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5 8.5h6M5 11h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function PlanIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M2 4h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2 8h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2 12h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ChevronWorkspacesIcon({
  expanded,
  className,
}: {
  expanded: boolean;
  className?: string;
}) {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(
        'shrink-0 text-muted-foreground transition-transform',
        expanded && 'rotate-90',
        className,
      )}
      aria-hidden
    >
      <path
        d="M3.5 2.5L6.5 5L3.5 7.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WorkspaceSidebarRow({
  session,
  title,
  taskStatus,
  restoring,
  active,
  onOpenSession,
  onMinimizeSession,
  onDeleteWorkspace,
}: {
  session: SessionTabMeta['session'];
  title: string;
  taskStatus?: SessionTabMeta['taskStatus'];
  restoring?: boolean;
  active: boolean;
  onOpenSession: (sessionId: string) => void;
  onMinimizeSession: (sessionId: string) => void;
  onDeleteWorkspace: (sessionId: string) => void;
}) {
  const running = session.status === 'running';
  return (
    <div
      className={cn(
        'group relative flex w-full items-center text-left text-[13px]',
        shellRadius,
        active && 'bg-muted/40 ring-1 ring-border/80',
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          'h-auto min-w-0 flex-1 gap-2 py-1.5 pl-2.5 pr-11 text-[13px]',
          shellSidebarLabelButton,
          active ? 'text-foreground' : cn(shellMutedTextClass, 'hover:text-foreground'),
        )}
        onClick={() => onOpenSession(session.id)}
        title={title}
      >
        {restoring ? (
          <Skeleton className="size-1.5 shrink-0 rounded-full" aria-hidden />
        ) : (
          <span
            className={cn(
              'inline-block size-1.5 shrink-0 rounded-full',
              workspaceSessionStatusDotClass(taskStatus, running),
            )}
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </Button>
      <div className="pointer-events-none absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5"
              onClick={(e) => {
                e.stopPropagation();
                onMinimizeSession(session.id);
              }}
              aria-label={`Minimize ${title}`}
            >
              <Minus />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Minimize — keep agent running</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteWorkspace(session.id);
              }}
              aria-label={`Delete workspace ${title}`}
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Delete workspace</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function PlanningDocFileSidebarRow({
  file,
  selected,
  onSelectPlanningDoc,
}: {
  file: PlanningDocFileEntry;
  selected: boolean;
  onSelectPlanningDoc: (relativePath: string) => void;
}) {
  return (
    <li className="w-full">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title={file.relativePath}
        onClick={() => onSelectPlanningDoc(file.relativePath)}
        className={shellNavFileRowClass(selected)}
      >
        <span className="min-w-0 flex-1 truncate">{planningDocSidebarFileLabel(file.relativePath)}</span>
        {file.syncStatus === 'conflict' ? (
          <Badge
            variant="outline"
            className="h-4 min-w-4 shrink-0 justify-center border-status-needs-input/30 bg-status-needs-input/15 px-0.5 text-[9px] text-status-needs-input-foreground"
            title="Sync conflict"
          >
            !
          </Badge>
        ) : file.syncStatus === 'pending_push' ? (
          <Badge
            variant="outline"
            className="h-4 shrink-0 border-status-review/30 bg-status-review/10 px-1 text-[9px] text-status-review-foreground"
            title="Pending upload"
          >
            ↑
          </Badge>
        ) : null}
      </Button>
    </li>
  );
}

function PlanningDocsSidebarList({
  projectId,
  files,
  activeTabId,
  settingsRouteActive,
  selectedPlanningDocPath,
  onSelectPlanningDoc,
}: {
  projectId: string;
  files: PlanningDocFileEntry[];
  activeTabId: string;
  settingsRouteActive: boolean;
  selectedPlanningDocPath: string | null;
  onSelectPlanningDoc: (relativePath: string) => void;
}) {
  const layout = useMemo(() => buildPlanningDocsSidebarLayout(files), [files]);
  const allFolderPaths = useMemo(
    () => (layout.kind === 'tree' ? collectPlanningDocFolderPaths(layout.nodes) : []),
    [layout],
  );
  const allFolderPathsKey = allFolderPaths.join('\0');

  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (hasPlanningDocFolderCollapseStateForProject(projectId)) {
      setCollapsedFolderPaths(readCollapsedPlanningDocFolderPathsForProject(projectId));
      return;
    }
    if (allFolderPaths.length > 0) {
      const defaults = defaultCollapsedPlanningDocFolderPaths(allFolderPaths);
      setCollapsedFolderPaths(defaults);
      writeCollapsedPlanningDocFolderPathsForProject(projectId, defaults);
      return;
    }
    setCollapsedFolderPaths(new Set());
  }, [projectId, allFolderPathsKey]);

  const toggleFolderSection = (folderPath: string) => {
    setCollapsedFolderPaths((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      writeCollapsedPlanningDocFolderPathsForProject(projectId, next);
      return next;
    });
  };

  const isDocSelected = (relativePath: string) =>
    activeTabId === 'docs' && !settingsRouteActive && relativePath === selectedPlanningDocPath;

  const renderTreeNode = (node: PlanningDocsSidebarTreeNode, depth: number) => {
    if (node.kind === 'file') {
      return (
        <PlanningDocFileSidebarRow
          key={node.file.relativePath}
          file={node.file}
          selected={isDocSelected(node.file.relativePath)}
          onSelectPlanningDoc={onSelectPlanningDoc}
        />
      );
    }

    const expanded = !collapsedFolderPaths.has(node.folderPath);
    return (
      <li key={node.folderPath} className="w-full list-none">
        <section aria-label={`${node.segment} folder`}>
          <div className={cn('ml-2', depth === 0 ? 'mt-0.5' : 'mt-1')}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.segment} folder`}
              title={node.folderPath}
              className={cn(
                'h-auto w-full gap-1 px-2 py-1 text-[12px] font-semibold text-foreground/90 hover:bg-muted/30',
                shellRadius,
                shellSidebarLabelButton,
              )}
              onClick={() => toggleFolderSection(node.folderPath)}
            >
              <ChevronWorkspacesIcon expanded={expanded} />
              <Folder className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{node.segment}</span>
            </Button>
            {expanded ? (
              <ul
                className={cn(
                  'ml-2 mt-0.5 flex list-none flex-col gap-0.5 border-l pl-2',
                  shellDivider,
                )}
              >
                {node.children.map((child) => renderTreeNode(child, depth + 1))}
              </ul>
            ) : null}
          </div>
        </section>
      </li>
    );
  };

  if (layout.kind === 'flat') {
    return (
      <ul className="flex w-full flex-col gap-0.5 pb-0">
        {layout.files.map((file) => (
          <PlanningDocFileSidebarRow
            key={file.relativePath}
            file={file}
            selected={isDocSelected(file.relativePath)}
            onSelectPlanningDoc={onSelectPlanningDoc}
          />
        ))}
      </ul>
    );
  }

  return (
    <ul className="flex w-full flex-col gap-0.5 pb-0">
      {layout.nodes.map((node) => renderTreeNode(node, 0))}
    </ul>
  );
}

function TaskWorkspaceSidebarList({
  projectId,
  sessionLayout,
  restoringWorkspaceIds,
  activeTabId,
  settingsRouteActive,
  onOpenSession,
  onMinimizeSession,
  onDeleteWorkspace,
}: {
  projectId: string;
  sessionLayout: SidebarSessionLayout;
  restoringWorkspaceIds?: ReadonlySet<string>;
  activeTabId: string;
  settingsRouteActive: boolean;
  onOpenSession: (sessionId: string) => void;
  onMinimizeSession: (sessionId: string) => void;
  onDeleteWorkspace: (sessionId: string) => void;
}) {
  const [collapsedRepoIds, setCollapsedRepoIds] = useState<Set<string>>(() =>
    readCollapsedRepoIdsForProject(projectId),
  );

  useEffect(() => {
    setCollapsedRepoIds(readCollapsedRepoIdsForProject(projectId));
  }, [projectId]);

  useEffect(() => {
    writeCollapsedRepoIdsForProject(projectId, collapsedRepoIds);
  }, [projectId, collapsedRepoIds]);

  const toggleRepoSection = (repoId: string) => {
    setCollapsedRepoIds((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  };

  const renderItem = ({ session, title, taskStatus, restoring }: SessionTabMeta) => (
    <WorkspaceSidebarRow
      key={session.id}
      restoring={restoring ?? restoringWorkspaceIds?.has(session.id)}
      session={session}
      title={title}
      taskStatus={taskStatus}
      active={activeTabId === session.id && !settingsRouteActive}
      onOpenSession={onOpenSession}
      onMinimizeSession={onMinimizeSession}
      onDeleteWorkspace={onDeleteWorkspace}
    />
  );

  if (sessionLayout.kind === 'flat') {
    return <>{sessionLayout.items.map(renderItem)}</>;
  }

  return (
    <>
      {sessionLayout.groups.map((group, index) => {
        const expanded = !collapsedRepoIds.has(group.repoId);
        return (
          <section key={group.repoId} aria-label={group.label}>
            <div className={cn('ml-2', index === 0 ? 'mt-0.5' : 'mt-2')}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                title={group.label}
                className={cn(
                  'h-auto w-full gap-1 px-2 py-1 text-[12px] font-semibold text-foreground/90 hover:bg-muted/30',
                  shellRadius,
                  shellSidebarLabelButton,
                )}
                onClick={() => toggleRepoSection(group.repoId)}
              >
                <ChevronWorkspacesIcon expanded={expanded} />
                <FolderGit2
                  className="size-3.5 shrink-0 text-status-success"
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
              </Button>
              {expanded ? (
                <div className={cn('ml-2 mt-0.5 flex flex-col gap-0.5 border-l pl-2', shellDivider)}>
                  {group.items.map(renderItem)}
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </>
  );
}

export function Sidebar({
  project,
  activeTabId,
  settingsRouteActive,
  onSelectTab,
  onOpenSettings,
  onPlanNavClick,
  onDocsNavClick,
  docsSidebarExpanded,
  onDocsSidebarExpandToggle,
  planningDocFiles,
  planningDocsCloudListMeta,
  planningDocsListLoading,
  planningDocsListError,
  selectedPlanningDocPath,
  onSelectPlanningDoc,
  sessionLayout,
  restoringWorkspaceIds,
  onOpenSession,
  onMinimizeSession,
  onDeleteWorkspace,
  onClearProject,
  onCollapse,
  updateFooter,
}: SidebarProps) {
  const [workspacesExpanded, setWorkspacesExpanded] = useState(true);

  const planNavActive =
    !settingsRouteActive && (activeTabId === 'plan' || activeTabId.startsWith('plan:'));

  const docsNavActive = activeTabId === 'docs' && !settingsRouteActive;

  return (
    <aside
      className={cn(
        'flex h-full w-[220px] shrink-0 flex-col border-r bg-card text-left text-card-foreground',
        shellDivider,
      )}
    >
      <div className="px-3 pb-3 pt-3.5">
        <div className="flex items-center justify-between gap-1">
          <div
            className={cn(
              'text-left text-[11px] font-medium uppercase tracking-[0.12em]',
              shellMutedTextClass,
            )}
          >
            Fluxx
          </div>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onCollapse}
                  aria-label="Collapse sidebar"
                  className={shellIconButtonClass()}
                >
                  <PanelLeftClose />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Collapse sidebar</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="mt-1.5 flex items-start gap-1.5">
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight text-foreground"
            title={project.rootPath}
          >
            {project.name}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onOpenSettings}
                aria-label="Project settings"
                aria-pressed={settingsRouteActive}
                className={shellIconButtonClass(settingsRouteActive)}
              >
                <SettingsIcon className="opacity-80" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Project settings</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <Separator className={cn('mx-3 w-auto bg-border/40')} />
      <div className="flex min-h-0 flex-1 flex-col px-2 py-3">
        <div
          className={cn(
            'px-2 pb-2 text-left text-[11px] font-medium uppercase tracking-[0.12em]',
            shellMutedTextClass,
          )}
        >
          Workspace
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
          <div className="flex flex-col gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={shellNavButtonClass(activeTabId === 'board' && !settingsRouteActive)}
              onClick={() => onSelectTab('board')}
            >
              <BoardIcon className="shrink-0 opacity-80" />
              <span>Board</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={shellNavButtonClass(planNavActive)}
              onClick={onPlanNavClick}
            >
              <PlanIcon className="shrink-0 opacity-80" />
              <span>Plan</span>
            </Button>
            <div className="flex flex-col gap-0.5">
              <div className={shellNavRowClass(docsNavActive)}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'min-w-0 flex-1 gap-2 shadow-none',
                    shellSidebarLabelButton,
                    docsNavActive
                      ? 'text-accent-foreground hover:bg-transparent'
                      : cn(shellMutedTextClass, 'hover:bg-transparent'),
                  )}
                  onClick={onDocsNavClick}
                >
                  <DocsIcon className="shrink-0 opacity-80" />
                  <span className="truncate">Docs</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'size-7 shrink-0 shadow-none',
                    docsNavActive
                      ? 'text-accent-foreground hover:bg-transparent'
                      : cn(shellMutedTextClass, 'hover:bg-transparent'),
                  )}
                  aria-expanded={docsSidebarExpanded}
                  aria-label={docsSidebarExpanded ? 'Collapse document list' : 'Expand document list'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDocsSidebarExpandToggle();
                  }}
                >
                  <ChevronWorkspacesIcon expanded={docsSidebarExpanded} />
                </Button>
              </div>
              <div
                className={cn(
                  'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
                  docsSidebarExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                )}
              >
                <div
                  className={cn(
                    'ml-2 max-h-[min(12rem,calc(100vh-16rem))] min-h-0 overflow-y-auto border-l pl-2 pt-0.5',
                    shellDivider,
                  )}
                >
                  {project.kind === 'cloud' ? (
                    <PlanningCloudDocsSyncHint meta={planningDocsCloudListMeta} />
                  ) : null}
                  {planningDocsListError ? (
                    <p className="px-2 py-1 text-left text-[10px] leading-snug text-destructive">
                      {planningDocsListError}
                    </p>
                  ) : planningDocsListLoading && planningDocFiles.length === 0 ? (
                    <p className="px-2 py-1 text-left text-[10px] text-muted-foreground">Loading…</p>
                  ) : planningDocFiles.length === 0 ? (
                    <p className="px-2 py-1 text-left text-[10px] leading-snug text-muted-foreground">
                      No .md files yet.
                    </p>
                  ) : (
                    <PlanningDocsSidebarList
                      projectId={project.id}
                      files={planningDocFiles}
                      activeTabId={activeTabId}
                      settingsRouteActive={settingsRouteActive}
                      selectedPlanningDocPath={selectedPlanningDocPath}
                      onSelectPlanningDoc={onSelectPlanningDoc}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-0.5 flex min-h-0 flex-col">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setWorkspacesExpanded((v) => !v)}
              className={cn(
                'h-auto gap-1 px-2 pb-0.5 pt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] hover:text-foreground',
                shellMutedTextClass,
                shellSidebarLabelButton,
              )}
              aria-expanded={workspacesExpanded}
            >
              <ChevronWorkspacesIcon expanded={workspacesExpanded} />
              <span>Task Workspaces</span>
            </Button>
            {workspacesExpanded ? (
              <div className="flex flex-col gap-0.5 overflow-y-auto">
                <TaskWorkspaceSidebarList
                  projectId={project.id}
                  sessionLayout={sessionLayout}
                  restoringWorkspaceIds={restoringWorkspaceIds}
                  activeTabId={activeTabId}
                  settingsRouteActive={settingsRouteActive}
                  onOpenSession={onOpenSession}
                  onMinimizeSession={onMinimizeSession}
                  onDeleteWorkspace={onDeleteWorkspace}
                />
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1" aria-hidden />
        </div>
        <div className={cn('border-t pt-2 text-left', shellDivider)}>
          {updateFooter ? <div className="mb-2 text-left">{updateFooter}</div> : null}
          <AppearanceToggle variant="footer" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClearProject}
            className={cn(
              'h-auto w-full px-2 py-1.5 text-[12px] text-muted-foreground hover:text-foreground',
              shellSidebarLabelButton,
            )}
          >
            Close project
          </Button>
        </div>
      </div>
    </aside>
  );
}
