import { useState } from 'react';
import type { Project } from '../types';
import type { SessionTabMeta } from './TabBar';

export type PlanningDocFile = { relativePath: string };

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
  planningDocFiles: PlanningDocFile[];
  planningDocsListLoading: boolean;
  planningDocsListError: string | null;
  selectedPlanningDocPath: string | null;
  onSelectPlanningDoc: (relativePath: string) => void;
  sessions: SessionTabMeta[];
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteWorkspace: (sessionId: string) => void;
  onClearProject: () => void;
  onCollapse: () => void;
}

function SidebarCollapseIcon({ className }: { className?: string }) {
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
      <path d="M10.5 6L8 8l2.5 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
      <circle
        cx="12"
        cy="12"
        r="3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function ChevronIcon({ expanded, className }: { expanded: boolean; className?: string }) {
  return (
    <svg
      className={[className, expanded ? 'rotate-180' : ''].filter(Boolean).join(' ')}
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M3.5 5.25 7 8.75l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronWorkspacesIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={[
        'shrink-0 text-flux-fg-subtle transition-transform',
        expanded ? 'rotate-90' : '',
      ].join(' ')}
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

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="1.5" y="3" width="13" height="3" rx="0.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 6.5V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6.5 9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M2.5 4h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6 4V2.75A0.75 0.75 0 0 1 6.75 2h2.5a0.75 0.75 0 0 1 0.75 0.75V4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 4.5V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
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
  planningDocsListLoading,
  planningDocsListError,
  selectedPlanningDocPath,
  onSelectPlanningDoc,
  sessions,
  onOpenSession,
  onArchiveSession,
  onDeleteWorkspace,
  onClearProject,
  onCollapse,
}: SidebarProps) {
  const [workspacesExpanded, setWorkspacesExpanded] = useState(true);

  const navItemClass = (active: boolean) =>
    [
      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
      active
        ? 'bg-flux-selected/10 text-flux-fg ring-1 ring-inset ring-flux-border/12'
        : 'text-flux-fg-subtle hover:bg-flux-hover/6 hover:text-flux-fg',
    ].join(' ');

  const docsMainNavClass = (active: boolean) =>
    [
      'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
      active
        ? 'bg-flux-selected/10 text-flux-fg ring-1 ring-inset ring-flux-border/12'
        : 'text-flux-fg-subtle hover:bg-flux-hover/6 hover:text-flux-fg',
    ].join(' ');

  const fileRowClass = (active: boolean) =>
    [
      'w-full truncate rounded-md py-1 pl-2 pr-1.5 text-left font-mono text-[11px] transition-colors',
      active
        ? 'bg-flux-selected/10 text-flux-fg ring-1 ring-inset ring-flux-border/12'
        : 'text-flux-fg-subtle hover:bg-flux-hover/6 hover:text-flux-fg',
    ].join(' ');

  const planNavActive =
    !settingsRouteActive && (activeTabId === 'plan' || activeTabId.startsWith('plan:'));

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-flux-border/10 bg-flux-sidebar text-flux-fg">
      <div className="px-3 pb-3 pt-3.5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-flux-fg-subtle">
            Flux
          </div>
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="-mr-1 shrink-0 rounded p-1 text-flux-fg-subtle transition hover:bg-flux-hover/8 hover:text-flux-fg"
          >
            <SidebarCollapseIcon />
          </button>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight text-flux-fg"
            title={project.rootPath}
          >
            {project.name}
          </span>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Project settings"
            title="Project settings"
            aria-pressed={settingsRouteActive}
            className={[
              '-mr-2 shrink-0 rounded p-1 transition',
              settingsRouteActive
                ? 'bg-flux-selected/10 text-flux-fg-muted'
                : 'text-flux-fg-subtle hover:bg-flux-hover/8 hover:text-flux-fg',
            ].join(' ')}
          >
            <SettingsIcon className="opacity-80" />
          </button>
        </div>
      </div>
      <div className="mx-3 border-t border-flux-border/10" />
      <div className="flex min-h-0 flex-1 flex-col px-2 py-3">
        <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-flux-fg-subtle">
          Workspace
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              className={navItemClass(activeTabId === 'board' && !settingsRouteActive)}
              onClick={() => onSelectTab('board')}
            >
              <BoardIcon className="shrink-0 opacity-80" />
              <span>Board</span>
            </button>
            <button type="button" className={navItemClass(planNavActive)} onClick={onPlanNavClick}>
              <PlanIcon className="shrink-0 opacity-80" />
              <span>Plan</span>
            </button>
            <div className="flex flex-col gap-0.5">
              <div className="flex w-full min-w-0 items-stretch gap-0.5">
                <button
                  type="button"
                  className={docsMainNavClass(activeTabId === 'docs' && !settingsRouteActive)}
                  onClick={onDocsNavClick}
                >
                  <DocsIcon className="shrink-0 opacity-80" />
                  <span className="min-w-0 truncate">Docs</span>
                </button>
                <button
                  type="button"
                  className={[
                    'flex w-7 shrink-0 items-center justify-center rounded-md transition-colors',
                    docsSidebarExpanded
                      ? 'bg-flux-selected/10 text-flux-fg ring-1 ring-inset ring-flux-border/12'
                      : 'text-flux-fg-subtle hover:bg-flux-hover/6 hover:text-flux-fg-muted',
                  ].join(' ')}
                  aria-expanded={docsSidebarExpanded}
                  aria-label={docsSidebarExpanded ? 'Collapse document list' : 'Expand document list'}
                  title={docsSidebarExpanded ? 'Hide file list' : 'Show file list'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDocsSidebarExpandToggle();
                  }}
                >
                  <ChevronIcon expanded={docsSidebarExpanded} className="opacity-90 transition-transform" />
                </button>
              </div>
              {docsSidebarExpanded ? (
                <div className="ml-2 max-h-[min(12rem,calc(100vh-16rem))] overflow-y-auto border-l border-flux-border/10 pl-2 pt-0.5">
                  {planningDocsListError ? (
                    <p className="py-1 text-[10px] leading-snug text-flux-danger">{planningDocsListError}</p>
                  ) : planningDocsListLoading && planningDocFiles.length === 0 ? (
                    <p className="py-1 text-[10px] text-flux-fg-subtle">Loading…</p>
                  ) : planningDocFiles.length === 0 ? (
                    <p className="py-1 text-[10px] leading-snug text-flux-fg-subtle">No .md files yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-0.5 pb-1">
                      {planningDocFiles.map((f) => (
                        <li key={f.relativePath}>
                          <button
                            type="button"
                            title={f.relativePath}
                            onClick={() => onSelectPlanningDoc(f.relativePath)}
                            className={fileRowClass(
                              activeTabId === 'docs' &&
                                !settingsRouteActive &&
                                f.relativePath === selectedPlanningDocPath,
                            )}
                          >
                            {f.relativePath}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex min-h-0 flex-col">
            <button
              type="button"
              onClick={() => setWorkspacesExpanded((v) => !v)}
              className="flex items-center gap-1 px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-flux-fg-subtle transition hover:text-flux-fg-muted"
              aria-expanded={workspacesExpanded}
            >
              <ChevronWorkspacesIcon expanded={workspacesExpanded} />
              <span>Task Workspaces</span>
            </button>
            {workspacesExpanded ? (
              <div className="flex flex-col gap-0.5 overflow-y-auto">
                {sessions.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] italic text-flux-fg-subtle">No open sessions</p>
                ) : (
                  sessions.map(({ session, title }) => {
                    const active = activeTabId === session.id && !settingsRouteActive;
                    const running = session.status === 'running';
                    return (
                      <div
                        key={session.id}
                        className={[
                          'group relative flex w-full items-center rounded-md text-left text-[13px] transition-colors',
                          active
                            ? 'bg-flux-selected/10 text-flux-fg ring-1 ring-inset ring-flux-border/12'
                            : 'text-flux-fg-subtle hover:bg-flux-hover/6 hover:text-flux-fg',
                        ].join(' ')}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2.5 pr-11 text-left"
                          onClick={() => onOpenSession(session.id)}
                          title={title}
                        >
                          <span
                            className={[
                              'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                              running ? 'bg-flux-success' : 'bg-flux-fg-subtle',
                            ].join(' ')}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate">{title}</span>
                        </button>
                        <div className="pointer-events-none absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onArchiveSession(session.id);
                            }}
                            aria-label={`Archive ${title}`}
                            title="Archive — kill agent and terminals (keep worktree)"
                            className="flex h-5 w-5 items-center justify-center rounded text-flux-fg-subtle transition hover:bg-flux-hover/10 hover:text-flux-fg"
                          >
                            <ArchiveIcon />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteWorkspace(session.id);
                            }}
                            aria-label={`Delete workspace ${title}`}
                            title="Delete workspace — kill agent, terminals, and remove worktree"
                            className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 transition hover:bg-red-500/[0.18] hover:text-red-300"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1" aria-hidden />
        </div>
        <div className="border-t border-flux-border/10 pt-2">
          <button
            type="button"
            onClick={onClearProject}
            className="w-full rounded-md px-2 py-1.5 text-left text-[12px] text-flux-fg-subtle transition-colors hover:bg-flux-hover/4 hover:text-flux-fg-muted"
          >
            Close project
          </button>
        </div>
      </div>
    </aside>
  );
}
