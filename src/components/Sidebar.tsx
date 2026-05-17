import { useState, type ReactNode } from 'react';
import type { Project } from '../types';
import type { SessionTabMeta } from './TabBar';
import type { PlanningDocFileEntry, PlanningDocsCloudListMeta } from '../planningDocs/types';
import type { PlanningDocsFirestoreStreamState } from '../renderer/planningDocs/usePlanningDocsFirestoreSync';

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
    <p className="mb-1 px-2 py-0.5 text-[10px] leading-snug text-zinc-600">
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
  sessions: SessionTabMeta[];
  onOpenSession: (sessionId: string) => void;
  onMinimizeSession: (sessionId: string) => void;
  onDeleteWorkspace: (sessionId: string) => void;
  onClearProject: () => void;
  onCollapse: () => void;
  /** Bottom chrome above “Close project” (e.g. app update control). */
  updateFooter?: ReactNode;
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

function ChevronWorkspacesIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={[
        'shrink-0 text-zinc-600 transition-transform',
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

function MinimizeWorkspaceIcon({ className }: { className?: string }) {
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
      <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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
  planningDocsCloudListMeta,
  planningDocsListLoading,
  planningDocsListError,
  selectedPlanningDocPath,
  onSelectPlanningDoc,
  sessions,
  onOpenSession,
  onMinimizeSession,
  onDeleteWorkspace,
  onClearProject,
  onCollapse,
  updateFooter,
}: SidebarProps) {
  const [workspacesExpanded, setWorkspacesExpanded] = useState(true);

  const navItemClass = (active: boolean) =>
    [
      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
      active
        ? 'bg-white/[0.06] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
        : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200',
    ].join(' ');

  const fileRowClass = (active: boolean) =>
    [
      'flex w-full min-w-0 items-center gap-1 rounded-md py-1 pl-2 pr-1.5 text-left font-mono text-[11px] transition-colors',
      active
        ? 'bg-white/[0.06] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
        : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200',
    ].join(' ');

  const planNavActive =
    !settingsRouteActive && (activeTabId === 'plan' || activeTabId.startsWith('plan:'));

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0c0c0e] text-zinc-100">
      <div className="px-3 pb-3 pt-3.5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600">Fluxx</div>
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="-mr-1 shrink-0 rounded p-1 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <SidebarCollapseIcon />
          </button>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight text-zinc-100"
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
                ? 'bg-white/[0.06] text-zinc-200'
                : 'text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200',
            ].join(' ')}
          >
            <SettingsIcon className="opacity-80" />
          </button>
        </div>
      </div>
      <div className="mx-3 border-t border-white/[0.06]" />
      <div className="flex min-h-0 flex-1 flex-col px-2 py-3">
        <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600">
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
              <div
                className={navItemClass(activeTabId === 'docs' && !settingsRouteActive)}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={onDocsNavClick}
                >
                  <DocsIcon className="shrink-0 opacity-80" />
                  <span className="min-w-0 flex-1 truncate">Docs</span>
                </button>
                <button
                  type="button"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-600 transition hover:bg-white/[0.06] hover:text-zinc-300"
                  aria-expanded={docsSidebarExpanded}
                  aria-label={docsSidebarExpanded ? 'Collapse document list' : 'Expand document list'}
                  title={docsSidebarExpanded ? 'Hide file list' : 'Show file list'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDocsSidebarExpandToggle();
                  }}
                >
                  <ChevronWorkspacesIcon expanded={docsSidebarExpanded} />
                </button>
              </div>
              <div
                className={[
                  'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
                  docsSidebarExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                ].join(' ')}
              >
                <div className="ml-2 max-h-[min(12rem,calc(100vh-16rem))] min-h-0 overflow-y-auto border-l border-white/[0.06] pl-2 pt-0.5">
                  {project.kind === 'cloud' ? (
                    <PlanningCloudDocsSyncHint
                      meta={planningDocsCloudListMeta}
                    />
                  ) : null}
                  {planningDocsListError ? (
                    <p className="py-1 text-[10px] leading-snug text-red-400/90">{planningDocsListError}</p>
                  ) : planningDocsListLoading && planningDocFiles.length === 0 ? (
                    <p className="py-1 text-[10px] text-zinc-600">Loading…</p>
                  ) : planningDocFiles.length === 0 ? (
                    <p className="py-1 text-[10px] leading-snug text-zinc-600">No .md files yet.</p>
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
                            <span className="min-w-0 flex-1 truncate">{f.relativePath}</span>
                            {f.syncStatus === 'conflict' ? (
                              <span
                                className="shrink-0 text-[10px] font-sans font-semibold text-amber-400/95"
                                title="Sync conflict"
                                aria-hidden
                              >
                                !
                              </span>
                            ) : f.syncStatus === 'pending_push' ? (
                              <span
                                className="shrink-0 text-[10px] font-sans text-sky-400/90"
                                title="Pending upload"
                                aria-hidden
                              >
                                ↑
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex min-h-0 flex-col">
            <button
              type="button"
              onClick={() => setWorkspacesExpanded((v) => !v)}
              className="flex items-center gap-1 px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600 transition hover:text-zinc-400"
              aria-expanded={workspacesExpanded}
            >
              <ChevronWorkspacesIcon expanded={workspacesExpanded} />
              <span>Task Workspaces</span>
            </button>
            {workspacesExpanded ? (
              <div className="flex flex-col gap-0.5 overflow-y-auto">
                {sessions.length > 0
                  ? sessions.map(({ session, title }) => {
                    const active = activeTabId === session.id && !settingsRouteActive;
                    const running = session.status === 'running';
                    return (
                      <div
                        key={session.id}
                        className={[
                          'group relative flex w-full items-center rounded-md text-left text-[13px] transition-colors',
                          active
                            ? 'bg-white/[0.06] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
                            : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200',
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
                              running ? 'bg-emerald-400' : 'bg-zinc-600',
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
                              onMinimizeSession(session.id);
                            }}
                            aria-label={`Minimize ${title}`}
                            title="Minimize — hide from sidebar, keep agent running"
                            className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-200"
                          >
                            <MinimizeWorkspaceIcon />
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
                  : null}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1" aria-hidden />
        </div>
        <div className="border-t border-white/[0.06] pt-2">
          {updateFooter ? <div className="mb-2">{updateFooter}</div> : null}
          <button
            type="button"
            onClick={onClearProject}
            className="w-full rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-600 transition-colors hover:bg-white/[0.03] hover:text-zinc-400"
          >
            Close project
          </button>
        </div>
      </div>
    </aside>
  );
}
