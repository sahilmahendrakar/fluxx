import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { ShellPlacement } from '../types';

const MENU_Z = 300;

export interface SessionShellAddMenuProps {
  running: boolean;
  localWorktreeAvailable: boolean;
  onOpenShell: (placement: ShellPlacement) => void | Promise<void>;
}

export function SessionShellAddMenu({
  running,
  localWorktreeAvailable,
  onOpenShell,
}: SessionShellAddMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 200 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const measureMenu = useCallback(() => {
    const tr = triggerRef.current;
    if (!tr) return;
    const r = tr.getBoundingClientRect();
    const width = Math.max(200, r.width + 24);
    let left = r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const top = r.bottom + 4;
    setMenuPos({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    measureMenu();
    window.addEventListener('resize', measureMenu);
    return () => window.removeEventListener('resize', measureMenu);
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
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const pick = (placement: ShellPlacement) => {
    setMenuOpen(false);
    void onOpenShell(placement);
  };

  const menu =
    menuOpen && typeof document !== 'undefined'
      ? createPortal(
          <ShellAddMenuPortal
            menuRef={menuRef}
            menuPos={menuPos}
            running={running}
            localWorktreeAvailable={localWorktreeAvailable}
            onPick={pick}
          />,
          document.body,
        )
      : null;

  const disabled = !running;

  return (
    <div ref={wrapRef} className="ml-1 flex shrink-0 items-stretch">
      <button
        type="button"
        onClick={() => running && void onOpenShell('remote')}
        disabled={disabled}
        title={running ? 'Open SSH terminal in remote worktree' : 'Session is not running'}
        aria-label="Open SSH terminal"
        className={[
          'flex h-6 w-6 items-center justify-center rounded-l-md text-[16px] leading-none transition',
          running
            ? 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
            : 'cursor-not-allowed text-zinc-700',
        ].join(' ')}
      >
        +
      </button>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Choose terminal type"
        title="SSH or local terminal"
        onClick={() => {
          if (!running) return;
          setMenuOpen((o) => !o);
        }}
        className={[
          'flex h-6 w-5 items-center justify-center rounded-r-md border-l border-white/[0.06] transition',
          running
            ? 'text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200'
            : 'cursor-not-allowed text-zinc-700',
        ].join(' ')}
      >
        <ChevronDown className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      </button>
      {menu}
    </div>
  );
}

function ShellAddMenuPortal({
  menuRef,
  menuPos,
  running,
  localWorktreeAvailable,
  onPick,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  menuPos: { top: number; left: number; width: number };
  running: boolean;
  localWorktreeAvailable: boolean;
  onPick: (placement: ShellPlacement) => void;
}) {
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="New terminal"
      className="fixed rounded-lg border border-white/[0.08] bg-[#121214] py-1 shadow-lg ring-1 ring-black/40"
      style={{ zIndex: MENU_Z, top: menuPos.top, left: menuPos.left, width: menuPos.width }}
    >
      <ShellMenuItem
        label="SSH terminal"
        detail="Remote worktree on SSH device"
        disabled={!running}
        onClick={() => onPick('remote')}
      />
      <ShellMenuItem
        label="Local terminal"
        detail={
          localWorktreeAvailable
            ? 'Synced worktree on this Mac'
            : 'Sync to local first'
        }
        disabled={!running || !localWorktreeAvailable}
        onClick={() => onPick('local')}
      />
    </div>
  );
}

function ShellMenuItem({
  label,
  detail,
  disabled,
  onClick,
}: {
  label: string;
  detail: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex w-full flex-col items-start px-3 py-2 text-left transition focus-visible:outline-none',
        disabled
          ? 'cursor-not-allowed text-zinc-600'
          : 'text-zinc-200 hover:bg-white/[0.06] focus-visible:bg-white/[0.06]',
      ].join(' ')}
    >
      <span className="text-[12px] font-medium">{label}</span>
      <span className="text-[11px] text-zinc-500">{detail}</span>
    </button>
  );
}
