export type WorkspaceNavView = 'board' | 'plan';

interface SidebarProps {
  workspaceView: WorkspaceNavView;
  onWorkspaceViewChange: (view: WorkspaceNavView) => void;
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

export function Sidebar({ workspaceView, onWorkspaceViewChange }: SidebarProps) {
  const navItemClass = (active: boolean) =>
    [
      'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
      active
        ? 'bg-gray-800 text-gray-100'
        : 'text-gray-500 hover:bg-gray-800/50 hover:text-gray-100',
    ].join(' ');

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col bg-gray-900 text-gray-100">
      <div className="px-3 py-3">
        <div className="text-base font-medium text-gray-100">Flux</div>
        <div className="text-sm text-gray-500">my-project</div>
      </div>
      <div className="border-t border-gray-800" />
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Workspace</div>
        <div className="mt-2 flex flex-col gap-1">
          <button
            type="button"
            className={navItemClass(workspaceView === 'board')}
            onClick={() => onWorkspaceViewChange('board')}
          >
            <BoardIcon className="shrink-0 text-current" />
            <span>Board</span>
          </button>
          <button
            type="button"
            className={navItemClass(workspaceView === 'plan')}
            onClick={() => onWorkspaceViewChange('plan')}
          >
            <PlanIcon className="shrink-0 text-current" />
            <span>Plan</span>
          </button>
        </div>
        <div className="min-h-0 flex-1" aria-hidden />
        <div className="pt-2">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-500 transition-colors hover:bg-gray-800/50 hover:text-gray-100"
          >
            <SettingsIcon className="shrink-0 text-current" />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
