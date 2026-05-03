import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { AgentModelUiKind } from '../agentModelUi';
import { AGENTS, DEFAULT_CURSOR_AGENT_MODEL, type Agent } from '../types';
import AgentModelPicker from './AgentModelPicker';
import { AGENT_SESSION_PREFS_SURFACE, isAgentSessionPrefsSurfaceTarget } from './agentSessionPrefsSurface';
import { SettingsSwitch } from './SettingsSwitch';

export { AGENT_SESSION_PREFS_SURFACE, isAgentSessionPrefsSurfaceTarget } from './agentSessionPrefsSurface';

/** Same classes as project settings “Default task agent” / planning spawn agent `<select>`. */
export const AGENT_SPAWN_AGENT_SELECT_CLASS =
  'flex h-8 w-full cursor-pointer items-center rounded-md border border-zinc-800/90 bg-zinc-950/80 px-2 py-0 pr-6 text-[12px] leading-none text-zinc-100 outline-none transition-colors hover:bg-zinc-900/80 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600/30 disabled:cursor-not-allowed disabled:opacity-50';

export function agentModelUiKindForAgent(agent: Agent): AgentModelUiKind | null {
  return agent === 'cursor' ? 'cursor' : agent === 'claude-code' ? 'claude-code' : null;
}

export type AgentSessionPrefsMenuContentProps = {
  selectedAgent: Agent;
  claudeModelId: string;
  cursorModelId: string;
  agentYolo: boolean;
  onPickAgent: (agent: Agent) => void;
  onPickModel: (kind: AgentModelUiKind, modelId: string) => void;
  onToggleYolo: (next: boolean) => void;
};

export function AgentSessionPrefsMenuContent({
  selectedAgent,
  claudeModelId,
  cursorModelId,
  agentYolo,
  onPickAgent,
  onPickModel,
  onToggleYolo,
}: AgentSessionPrefsMenuContentProps) {
  const uid = useId();
  const agentSelectId = `${uid}-agent`;
  const yoloLabelId = `${uid}-yolo`;
  const mk = agentModelUiKindForAgent(selectedAgent);

  const modelPickerKind: AgentModelUiKind | null = mk;
  const modelPickerId =
    selectedAgent === 'cursor'
      ? cursorModelId.trim() || DEFAULT_CURSOR_AGENT_MODEL
      : selectedAgent === 'claude-code'
        ? claudeModelId.trim()
        : '';

  const yoloTitle =
    'Fewer permission prompts for spawns (Cursor --yolo / --force; Claude Code --dangerously-skip-permissions).';

  const darkSelectStyle = { colorScheme: 'dark' } as CSSProperties;

  return (
    <div className="w-[min(calc(100vw-12px),13rem)] space-y-1.5 p-2">
      <select
        id={agentSelectId}
        value={selectedAgent}
        aria-label="Agent"
        onChange={(e) => onPickAgent(e.target.value as Agent)}
        className={AGENT_SPAWN_AGENT_SELECT_CLASS}
        style={darkSelectStyle}
      >
        {AGENTS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>

      {modelPickerKind ? (
        <AgentModelPicker
          kind={modelPickerKind}
          modelId={modelPickerId}
          onModelIdChange={(id) => onPickModel(modelPickerKind, id)}
          aria-label="Model"
        />
      ) : (
        <div
          className="flex h-8 items-center rounded-md border border-dashed border-zinc-800/70 bg-zinc-950/30 px-2 text-[11px] text-zinc-500"
          title="Model selection is not wired for Codex in this version."
        >
          Default model
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-zinc-800/60 pt-1.5">
        <span id={yoloLabelId} className="text-[10px] font-medium text-zinc-500" title={yoloTitle}>
          YOLO
        </span>
        <SettingsSwitch
          size="sm"
          checked={agentYolo}
          onCheckedChange={onToggleYolo}
          ariaLabelledBy={yoloLabelId}
        />
      </div>
    </div>
  );
}

type AgentSessionPrefsMenuPortalProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  /** Shown on the portaled root (`role="dialog"`). */
  ariaLabel: string;
  children: React.ReactNode;
};

type MenuLayout = { top: number; left: number; width: number };

export function AgentSessionPrefsMenuPortal({
  open,
  anchorRef,
  dropdownRef,
  onClose,
  ariaLabel,
  children,
}: AgentSessionPrefsMenuPortalProps) {
  const [layout, setLayout] = useState<MenuLayout>({
    top: 0,
    left: 0,
    width: 208,
  });

  const computeLayout = useCallback(() => {
    const anchorEl = anchorRef.current;
    if (!anchorEl) return;

    const width = 208;
    const margin = 8;
    const gap = 8;
    const ar = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = ar.right - width;
    left = Math.min(Math.max(margin, left), vw - width - margin);

    const menuEl = dropdownRef.current;
    const h = menuEl?.getBoundingClientRect().height ?? 200;
    let top = ar.bottom + gap;
    const roomBelow = vh - margin - top;
    const aboveCandidate = ar.top - gap - h;
    const roomAbove = ar.top - margin - gap;

    if (h > roomBelow - 4 && aboveCandidate >= margin && roomAbove >= roomBelow) {
      top = aboveCandidate;
    } else if (h > roomBelow - 4 && aboveCandidate < margin) {
      top = margin;
    }

    top = Math.max(margin, Math.min(top, vh - margin - 56));

    setLayout({
      top: Math.round(top),
      left: Math.round(left),
      width,
    });
  }, [anchorRef, dropdownRef]);

  useLayoutEffect(() => {
    if (!open) return;

    let cancelled = false;
    const run = () => {
      if (!cancelled) computeLayout();
    };

    run();
    const id0 = requestAnimationFrame(run);
    const id1 = requestAnimationFrame(run);

    let ro: ResizeObserver | null = null;
    const el = dropdownRef.current;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(run);
      ro.observe(el);
    }

    window.addEventListener('resize', run);
    window.addEventListener('scroll', run, true);

    return () => {
      cancelled = true;
      cancelAnimationFrame(id0);
      cancelAnimationFrame(id1);
      ro?.disconnect();
      window.removeEventListener('resize', run);
      window.removeEventListener('scroll', run, true);
    };
  }, [open, computeLayout, dropdownRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      if (isAgentSessionPrefsSurfaceTarget(e.target)) return;
      const anchor = anchorRef.current;
      if (anchor && anchor.contains(e.target as Node)) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, anchorRef, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[5600] bg-zinc-950/25"
        aria-hidden
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        ref={dropdownRef as React.LegacyRef<HTMLDivElement>}
        {...{ [AGENT_SESSION_PREFS_SURFACE]: '' } as React.HTMLAttributes<HTMLDivElement>}
        className="fixed z-[5610] flex max-h-[min(85vh,calc(100vh-16px))] flex-col overflow-y-auto overflow-x-visible rounded-md border border-zinc-800/90 bg-zinc-950 p-0 text-zinc-50 shadow-md shadow-black/30"
        style={{
          top: layout.top,
          left: layout.left,
          width: layout.width,
        }}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
