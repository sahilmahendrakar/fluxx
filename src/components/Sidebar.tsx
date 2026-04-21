import { useState } from 'react';
import type { Project } from '../types';
import type { SessionTabMeta } from './TabBar';

interface SidebarProps {
  project: Project;
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
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

function TeamIcon({ className }: { className?: string }) {
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
      <circle cx="5.75" cy="6" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="6.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M2 13c0-1.66 1.68-3 3.75-3s3.75 1.34 3.75 3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M9.5 13c0-1.33 1.34-2.4 3-2.4s3 1.07 3 2.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
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
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1.25v1.75M8 13v1.75M1.25 8h1.75M13 8h1.75M3.05 3.05l1.24 1.24M11.71 11.71l1.24 1.24M12.95 3.05l-1.24 1.24M4.29 11.71l-1.24 1.24"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
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
  onSelectTab,
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
        ? 'bg-white/[0.06] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
        : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200',
    ].join(' ');

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0c0c0e] text-zinc-100">
      <div className="px-3 pb-3 pt-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600">Flux</div>
            <div className="mt-2 truncate text-[13px] font-medium tracking-tight text-zinc-100">
              {project.name}
            </div>
            <div
              className="mt-0.5 max-w-full truncate font-mono text-[11px] text-zinc-600"
              title={project.rootPath}
            >
              {project.rootPath}
            </div>
          </div>
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="shrink-0 rounded-md p-1 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <SidebarCollapseIcon />
          </button>
        </div>
      </div>
      <div className="mx-3 border-t border-white/[0.06]" />
      <div className="flex min-h-0 flex-1 flex-col px-2 py-3">
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            className={navItemClass(activeTabId === 'board')}
            onClick={() => onSelectTab('board')}
          >
            <BoardIcon className="shrink-0 opacity-80" />
            <span>Board</span>
          </button>
          <button
            type="button"
            className={navItemClass(activeTabId === 'plan')}
            onClick={() => onSelectTab('plan')}
          >
            <PlanIcon className="shrink-0 opacity-80" />
            <span>Plan</span>
          </button>
          {project.kind === 'cloud' ? (
            <button
              type="button"
              className={navItemClass(activeTabId === 'team')}
              onClick={() => onSelectTab('team')}
            >
              <TeamIcon className="shrink-0 opacity-80" />
              <span>Team</span>
            </button>
          ) : null}
        </div>

        <div className="mt-5 flex min-h-0 flex-col">
          <button
            type="button"
            onClick={() => setWorkspacesExpanded((v) => !v)}
            className="flex items-center gap-1 px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600 transition hover:text-zinc-400"
            aria-expanded={workspacesExpanded}
          >
            <ChevronIcon expanded={workspacesExpanded} />
            <span>Task Workspaces</span>
          </button>
          {workspacesExpanded ? (
            <div className="flex flex-col gap-0.5 overflow-y-auto">
              {sessions.length === 0 ? (
                <p className="px-2 py-1 text-[11px] italic text-zinc-600">
                  No open sessions
                </p>
              ) : (
                sessions.map(({ session, title }) => {
                  const active = activeTabId === session.id;
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
                            onArchiveSession(session.id);
                          }}
                          aria-label={`Archive ${title}`}
                          title="Archive — kill agent and terminals (keep worktree)"
                          className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-200"
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
        <div className="border-t border-white/[0.06] pt-2">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <SettingsIcon className="shrink-0 opacity-80" />
            <span>Settings</span>
          </button>
          <button
            type="button"
            onClick={onClearProject}
            className="mt-0.5 w-full rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-600 transition-colors hover:bg-white/[0.03] hover:text-zinc-400"
          >
            Close project
          </button>
        </div>
      </div>
    </aside>
  );
}
