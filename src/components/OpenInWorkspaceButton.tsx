import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { OpenWorkspaceTarget } from '../types';

const DEFAULT_DISABLED_TITLE = "Start a session to create this task's worktree first.";

function fileBrowserMenuLabel(): string {
  const p = window.electronAPI.platform;
  if (p === 'darwin') return 'Finder';
  if (p === 'win32') return 'File Explorer';
  return 'File manager';
}

function menuItems(): { target: OpenWorkspaceTarget; label: string }[] {
  return [
    { target: 'cursor', label: 'Cursor' },
    { target: 'vscode', label: 'VS Code' },
    { target: 'terminal', label: 'Terminal' },
    { target: 'file-manager', label: fileBrowserMenuLabel() },
  ];
}

export interface OpenInWorkspaceButtonProps {
  worktreePath?: string | null;
  disabledReason?: string;
  size?: 'sm' | 'md';
}

export function OpenInWorkspaceButton({
  worktreePath,
  disabledReason,
  size = 'md',
}: OpenInWorkspaceButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const enabled = Boolean(worktreePath?.trim());
  const disabledTitle = disabledReason ?? DEFAULT_DISABLED_TITLE;

  const sizeClass =
    size === 'sm'
      ? 'gap-1 px-3 py-1.5 text-[12px]'
      : 'gap-1.5 px-3 py-2 text-[13px]';
  const triggerIdle =
    'rounded-lg bg-white/[0.04] font-medium text-zinc-100 ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25';
  const triggerDisabled =
    'cursor-not-allowed rounded-lg bg-zinc-800/50 font-medium text-zinc-500 ring-1 ring-inset ring-white/[0.06]';

  useEffect(() => {
    if (!menuOpen) return;
    const onDocPointerDown = (e: MouseEvent) => {
      const root = wrapRef.current;
      if (root && !root.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const handlePick = useCallback(async (target: OpenWorkspaceTarget) => {
    const dir = worktreePath?.trim();
    if (!dir) return;
    setMenuOpen(false);
    const result = await window.electronAPI.workspace.openPath(dir, target);
    if ('error' in result) {
      setOpenError(result.error);
    } else {
      setOpenError(null);
    }
  }, [worktreePath]);

  const toggleMenu = () => {
    if (!enabled) return;
    setOpenError(null);
    setMenuOpen((o) => !o);
  };

  return (
    <div ref={wrapRef} className="relative flex flex-col items-stretch">
      <button
        ref={triggerRef}
        type="button"
        disabled={!enabled}
        title={enabled ? undefined : disabledTitle}
        aria-disabled={!enabled}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={toggleMenu}
        className={[
          'inline-flex items-center',
          sizeClass,
          enabled ? triggerIdle : triggerDisabled,
        ].join(' ')}
      >
        Open in
        <ChevronDown
          className={[
            'h-3.5 w-3.5 shrink-0 opacity-70 transition',
            menuOpen && enabled ? 'rotate-180' : '',
          ].join(' ')}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {menuOpen && enabled ? (
        <div
          role="menu"
          aria-label="Open workspace in"
          className="absolute right-0 top-full z-40 mt-1 min-w-[10.5rem] rounded-lg border border-white/[0.08] bg-[#121214] py-1 shadow-lg ring-1 ring-black/40"
        >
          {menuItems().map(({ target, label }) => (
            <button
              key={target}
              type="button"
              role="menuitem"
              className="flex w-full px-3 py-2 text-left text-[12px] text-zinc-200 transition hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none"
              onClick={() => void handlePick(target)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {openError ? (
        <p
          className="mt-1 max-w-[14rem] text-[11px] leading-snug text-red-300/90"
          role="status"
          aria-live="polite"
        >
          {openError}
        </p>
      ) : null}
    </div>
  );
}
