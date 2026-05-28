import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AgentModelUiKind } from '../agentModelUi';
import {
  appendAgentModelExtra,
  choicesForPicker,
  labelForModelId,
} from '../agentModelUi';
import {
  AGENT_SESSION_PREFS_NESTED_Z,
  AGENT_SESSION_PREFS_SURFACE,
} from './agentSessionPrefsSurface';

const menuItemClass =
  'relative flex w-full cursor-pointer select-none items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-xs leading-tight text-popover-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

interface AgentModelPickerProps {
  kind: AgentModelUiKind;
  /** Cursor: concrete model id (e.g. `auto`). Claude: `''` means CLI default (no `--model`). */
  modelId: string;
  onModelIdChange: (modelId: string) => void;
  'aria-label'?: string;
}

export default function AgentModelPicker({
  kind,
  modelId,
  onModelIdChange,
  'aria-label': ariaLabel,
}: AgentModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addId, setAddId] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [extrasGen, setExtrasGen] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownBox, setDropdownBox] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  }>({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 280,
  });

  const choices = useMemo(
    () => choicesForPicker(kind, modelId),
    [kind, modelId, extrasGen],
  );
  const displayLabel =
    (kind === 'claude-code' || kind === 'codex') && !modelId.trim()
      ? 'Default'
      : labelForModelId(kind, modelId);

  const closeAll = useCallback(() => {
    setOpen(false);
    setAddOpen(false);
    setAddId('');
    setAddLabel('');
    setAddError(null);
  }, []);

  const measureDropdown = useCallback(() => {
    const tr = triggerRef.current;
    if (!tr) return;
    const rect = tr.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const width = Math.min(Math.max(rect.width, 140), vw - margin * 2);
    let left = rect.left;
    left = Math.max(margin, Math.min(left, vw - width - margin));
    const gap = 4;
    const top = rect.bottom + gap;
    const maxHeight = Math.max(120, Math.min(280, vh - top - margin));
    setDropdownBox({ top, left, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measureDropdown();
    const id = requestAnimationFrame(measureDropdown);
    window.addEventListener('resize', measureDropdown);
    window.addEventListener('scroll', measureDropdown, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', measureDropdown);
      window.removeEventListener('scroll', measureDropdown, true);
    };
  }, [open, measureDropdown, choices.length, addOpen]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Node;
      const root = rootRef.current;
      const dropdown = dropdownRef.current;
      if (root?.contains(target) || dropdown?.contains(target)) return;
      closeAll();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, closeAll]);

  const handlePick = (id: string) => {
    onModelIdChange(id);
    closeAll();
  };

  const handleAdd = () => {
    setAddError(null);
    const id = addId.trim();
    if (!id) {
      setAddError('Enter a model id.');
      return;
    }
    const label = addLabel.trim() || id;
    const ok = appendAgentModelExtra(kind, { id, label });
    if (!ok) {
      setAddError('That id is already in the list (preset or added earlier).');
      return;
    }
    setExtrasGen((g) => g + 1);
    onModelIdChange(id);
    closeAll();
  };

  const listbox =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={dropdownRef}
            {...{ [AGENT_SESSION_PREFS_SURFACE]: '' } as React.HTMLAttributes<HTMLDivElement>}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed max-h-[min(18rem,calc(100vh-1rem))] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-popover p-0.5 text-popover-foreground shadow-md"
            style={{
              zIndex: AGENT_SESSION_PREFS_NESTED_Z,
              top: dropdownBox.top,
              left: dropdownBox.left,
              width: dropdownBox.width,
              maxHeight: dropdownBox.maxHeight,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {kind === 'claude-code' || kind === 'codex' ? (
              <button
                type="button"
                role="option"
                aria-selected={!modelId.trim()}
                className={cn(menuItemClass, !modelId.trim() && 'bg-accent/60')}
                onClick={() => handlePick('')}
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="font-medium text-foreground">Default</span>
                  <span className="block text-[10px] leading-tight text-muted-foreground">
                    CLI default
                  </span>
                </span>
                <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
                  {!modelId.trim() ? (
                    <Check className="size-3.5 text-muted-foreground" strokeWidth={2} />
                  ) : null}
                </span>
              </button>
            ) : null}
            {choices.map((p) => {
              const selected =
                kind === 'claude-code' || kind === 'codex'
                  ? modelId.trim() === p.id
                  : modelId.trim() === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(menuItemClass, selected && 'bg-accent/60')}
                  onClick={() => handlePick(p.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-left font-medium text-foreground">
                    {p.label}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{p.id}</span>
                  <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
                    {selected ? (
                      <Check className="size-3.5 text-muted-foreground" strokeWidth={2} />
                    ) : null}
                  </span>
                </button>
              );
            })}

            <div className="my-0.5 border-t border-border px-0.5 pt-0.5">
              {!addOpen ? (
                <button
                  type="button"
                  className={cn(menuItemClass, 'text-muted-foreground')}
                  onClick={() => {
                    setAddOpen(true);
                    setAddError(null);
                  }}
                >
                  <Plus data-icon="inline-start" strokeWidth={2} aria-hidden />
                  Add model…
                </button>
              ) : (
                <div className="flex flex-col gap-1.5 px-1.5 py-1.5">
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Id from <code className="text-foreground/80">claude --help</code> etc.
                  </p>
                  <Input
                    value={addId}
                    onChange={(e) => setAddId(e.target.value)}
                    placeholder="Model id"
                    className="h-7 font-mono text-[11px]"
                  />
                  <Input
                    value={addLabel}
                    onChange={(e) => setAddLabel(e.target.value)}
                    placeholder="Label (optional)"
                    className="h-7 text-[11px]"
                  />
                  {addError ? (
                    <p className="text-[10px] text-destructive">{addError}</p>
                  ) : null}
                  <div className="flex gap-1.5">
                    <Button type="button" size="sm" className="h-7 flex-1 text-[11px]" onClick={handleAdd}>
                      Add
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1 text-[11px]"
                      onClick={() => {
                        setAddOpen(false);
                        setAddId('');
                        setAddLabel('');
                        setAddError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative min-w-0 w-full max-w-full">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className="h-8 w-full justify-between px-2 text-xs font-normal"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span className="min-w-0 flex-1 truncate text-left">{displayLabel}</span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </Button>
      {listbox}
    </div>
  );
}
