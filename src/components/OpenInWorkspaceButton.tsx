import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  workspaceToolbarActionButtonClass,
  workspaceToolbarActionButtonDisabledClass,
} from '@/components/terminal/TerminalChrome';
import type { OpenWorkspaceTarget } from '../types';
import { OpenWorkspaceTargetIcon } from './openWorkspaceTargetIcons';

const DEFAULT_DISABLED_TITLE = "Start a session to open this task's working folder.";
const MENU_MAX_H_PX = 220;
const MENU_Z = 300;

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
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 200 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const enabled = Boolean(worktreePath?.trim());
  const disabledTitle = disabledReason ?? DEFAULT_DISABLED_TITLE;

  const sizeClass =
    size === 'sm'
      ? 'gap-1 px-3 py-1.5 text-[12px]'
      : 'gap-1.5 px-3 py-2 text-[13px]';
  const triggerIdle = cn(
    workspaceToolbarActionButtonClass,
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  );
  const triggerDisabled = workspaceToolbarActionButtonDisabledClass;

  const measureMenu = useCallback(() => {
    const tr = triggerRef.current;
    if (!tr) return;
    const r = tr.getBoundingClientRect();
    const width = Math.max(200, r.width);
    let left = r.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = r.bottom + 4;
    if (top + MENU_MAX_H_PX > window.innerHeight - 8) {
      top = r.top - 4 - MENU_MAX_H_PX;
    }
    if (top < 8) top = 8;
    setMenuPos({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    measureMenu();
    const id = requestAnimationFrame(measureMenu);
    window.addEventListener('resize', measureMenu);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', measureMenu);
    };
  }, [menuOpen, measureMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMenuOpen(false);
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

  useEffect(() => {
    if (!menuOpen) return;
    const onScroll = () => setMenuOpen(false);
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
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

  const menu =
    menuOpen && enabled && typeof document !== 'undefined'
      ? createPortal(
          <OpenWorkspaceMenu
            menuRef={menuRef}
            menuPos={menuPos}
            onPick={(target) => void handlePick(target)}
          />,
          document.body,
        )
      : null;

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
        className={cn('inline-flex items-center', sizeClass, enabled ? triggerIdle : triggerDisabled)}
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
      {menu}
      {openError ? (
        <p
          className="mt-1 max-w-[14rem] text-[11px] leading-snug text-destructive"
          role="status"
          aria-live="polite"
        >
          {openError}
        </p>
      ) : null}
    </div>
  );
}

function OpenWorkspaceMenu({
  menuRef,
  menuPos,
  onPick,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  menuPos: { top: number; left: number; width: number };
  onPick: (target: OpenWorkspaceTarget) => void;
}) {
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Open workspace in"
      className="fixed max-h-56 overflow-y-auto rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg"
      style={{
        zIndex: MENU_Z,
        top: menuPos.top,
        left: menuPos.left,
        width: menuPos.width,
        maxHeight: MENU_MAX_H_PX,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {menuItems().map(({ target, label }) => (
        <button
          key={target}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          onClick={() => onPick(target)}
        >
          <OpenWorkspaceTargetIcon target={target} />
          <span className="min-w-0 flex-1">{label}</span>
        </button>
      ))}
    </div>
  );
}
