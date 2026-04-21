import type { Project } from '../types';

export type WorkspaceNavView = 'board' | 'team';

interface SidebarProps {
  project: Project;
  workspaceView: WorkspaceNavView;
  onWorkspaceViewChange: (view: WorkspaceNavView) => void;
  onPlanNavClick: () => void;
  planPanelOpen: boolean;
  onClearProject: () => void;
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

export function Sidebar({
  project,
  workspaceView,
  onWorkspaceViewChange,
  onPlanNavClick,
  planPanelOpen,
  onClearProject,
}: SidebarProps) {
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
      <div className="mx-3 border-t border-white/[0.06]" />
      <div className="flex min-h-0 flex-1 flex-col px-2 py-3">
        <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-600">
          Workspace
        </div>
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            className={navItemClass(workspaceView === 'board')}
            onClick={() => onWorkspaceViewChange('board')}
          >
            <BoardIcon className="shrink-0 opacity-80" />
            <span>Board</span>
          </button>
          <button
            type="button"
            className={navItemClass(
              workspaceView === 'board' && planPanelOpen,
            )}
            onClick={onPlanNavClick}
          >
            <PlanIcon className="shrink-0 opacity-80" />
            <span>Plan</span>
          </button>
          {project.kind === 'cloud' ? (
            <button
              type="button"
              className={navItemClass(workspaceView === 'team')}
              onClick={() => onWorkspaceViewChange('team')}
            >
              <TeamIcon className="shrink-0 opacity-80" />
              <span>Team</span>
            </button>
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
