import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { AgentModelUiKind } from '../agentModelUi';
import { AGENTS, DEFAULT_CURSOR_AGENT_MODEL, type Agent } from '../types';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import AgentModelPicker from './AgentModelPicker';
import {
  AGENT_SESSION_PREFS_BACKDROP_Z,
  AGENT_SESSION_PREFS_MENU_Z,
  AGENT_SESSION_PREFS_NESTED_Z_CLASS,
  AGENT_SESSION_PREFS_SURFACE,
  isAgentSessionPrefsSurfaceTarget,
} from './agentSessionPrefsSurface';
import { SettingsSwitch } from './SettingsSwitch';
export {
  AGENT_SESSION_PREFS_SURFACE,
  isAgentSessionPrefsSurfaceTarget,
} from './agentSessionPrefsSurface';

/** Shared compact select for agent pickers (task detail, settings, spawn menus). */
export const AGENT_SPAWN_AGENT_SELECT_CLASS =
  'flex h-8 w-full cursor-pointer items-center rounded-md border border-input bg-background px-2 py-0 text-xs leading-none text-foreground outline-none transition-colors hover:bg-accent/50 focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export function agentModelUiKindForAgent(agent: Agent | null): AgentModelUiKind | null {
  if (agent == null) return null;
  if (agent === 'cursor') return 'cursor';
  if (agent === 'claude-code') return 'claude-code';
  if (agent === 'codex') return 'codex';
  return null;
}

export type AgentSessionPrefsMenuContentProps = {
  selectedAgent: Agent | null;
  claudeModelId: string;
  cursorModelId: string;
  codexModelId: string;
  agentYolo: boolean;
  onPickAgent: (agent: Agent | null) => void;
  onPickModel: (kind: AgentModelUiKind, modelId: string) => void;
  onToggleYolo: (next: boolean) => void;
  /**
   * Task card spawn menu: include **None** in the agent list and hide model / YOLO
   * controls until a real agent is selected.
   */
  taskSpawnSurface?: boolean;
};

export function AgentSessionPrefsMenuContent({
  selectedAgent,
  claudeModelId,
  cursorModelId,
  codexModelId,
  agentYolo,
  onPickAgent,
  onPickModel,
  onToggleYolo,
  taskSpawnSurface = false,
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
        : selectedAgent === 'codex'
          ? codexModelId.trim()
          : '';

  const yoloTitle =
    selectedAgent === 'codex'
      ? 'Fewer permission prompts for Codex spawns (--yolo / --dangerously-bypass-approvals-and-sandbox).'
      : 'Fewer permission prompts for spawns (Cursor --yolo / --force; Claude Code --dangerously-skip-permissions).';

  const showModelAndYolo = !taskSpawnSurface || selectedAgent != null;

  return (
    <div className="flex w-[min(calc(100vw-12px),13rem)] flex-col gap-1.5 p-2">
      <Select
        value={selectedAgent ?? (taskSpawnSurface ? '__none__' : '')}
        onValueChange={(v) => {
          if (v === '__none__' || v === '') {
            if (taskSpawnSurface) onPickAgent(null);
            return;
          }
          onPickAgent(v as Agent);
        }}
      >
        <SelectTrigger id={agentSelectId} aria-label="Agent" className={AGENT_SPAWN_AGENT_SELECT_CLASS}>
          <SelectValue placeholder="Agent" />
        </SelectTrigger>
        <SelectContent className={AGENT_SESSION_PREFS_NESTED_Z_CLASS}>
          <SelectGroup>
            {AGENTS.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.label}
              </SelectItem>
            ))}
            {taskSpawnSurface ? (
              <SelectItem value="__none__">None</SelectItem>
            ) : null}
          </SelectGroup>
        </SelectContent>
      </Select>

      {showModelAndYolo ? (
        <>
          {modelPickerKind ? (
            <AgentModelPicker
              kind={modelPickerKind}
              modelId={modelPickerId}
              onModelIdChange={(id) => onPickModel(modelPickerKind, id)}
              aria-label="Model"
            />
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t border-border pt-1.5">
            <span
              id={yoloLabelId}
              className="text-[10px] font-medium text-muted-foreground"
              title={yoloTitle}
            >
              YOLO
            </span>
            <SettingsSwitch
              size="sm"
              checked={agentYolo}
              onCheckedChange={onToggleYolo}
              ariaLabelledBy={yoloLabelId}
            />
          </div>
        </>
      ) : null}
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
        className="fixed inset-0 bg-background/40"
        style={{ zIndex: AGENT_SESSION_PREFS_BACKDROP_Z }}
        aria-hidden
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        ref={dropdownRef as React.LegacyRef<HTMLDivElement>}
        {...{ [AGENT_SESSION_PREFS_SURFACE]: '' } as React.HTMLAttributes<HTMLDivElement>}
        className="fixed flex max-h-[min(85vh,calc(100vh-16px))] flex-col overflow-y-auto overflow-x-visible rounded-md border border-border bg-popover p-0 text-popover-foreground shadow-md"
        style={{
          zIndex: AGENT_SESSION_PREFS_MENU_Z,
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
