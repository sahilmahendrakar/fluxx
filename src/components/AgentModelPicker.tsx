import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus } from 'lucide-react';
import type { AgentModelUiKind } from '../agentModelUi';
import {
  appendAgentModelExtra,
  choicesForPicker,
  labelForModelId,
} from '../agentModelUi';
import { AGENT_SESSION_PREFS_SURFACE } from './agentSessionPrefsSurface';

const menuItemClass =
  'relative flex w-full cursor-pointer select-none items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-[12px] leading-tight text-zinc-200 outline-none transition-colors hover:bg-zinc-800/80 hover:text-zinc-50 focus:bg-zinc-800/80 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

const triggerClass =
  'flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-md border border-zinc-800/90 bg-zinc-950/80 px-2 py-0 text-left text-[12px] leading-none text-zinc-100 outline-none transition-colors hover:bg-zinc-900/80 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600/30';

const MODEL_LIST_Z = 5620;

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
    kind === 'claude-code' && !modelId.trim()
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
            className="fixed max-h-[min(18rem,calc(100vh-1rem))] overflow-y-auto overflow-x-hidden rounded-md border border-zinc-800/90 bg-zinc-950 p-0.5 text-zinc-50 shadow-md shadow-black/25"
            style={{
              zIndex: MODEL_LIST_Z,
              top: dropdownBox.top,
              left: dropdownBox.left,
              width: dropdownBox.width,
              maxHeight: dropdownBox.maxHeight,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {kind === 'claude-code' ? (
              <button
                type="button"
                role="option"
                aria-selected={!modelId.trim()}
                className={`${menuItemClass} ${!modelId.trim() ? 'bg-zinc-800/60' : ''}`}
                onClick={() => handlePick('')}
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="font-medium text-zinc-100">Default</span>
                  <span className="block text-[10px] leading-tight text-zinc-500">CLI default</span>
                </span>
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
                  {!modelId.trim() ? <Check className="h-3.5 w-3.5 text-zinc-400" strokeWidth={2} /> : null}
                </span>
              </button>
            ) : null}
            {choices.map((p) => {
              const selected =
                kind === 'claude-code' ? modelId.trim() === p.id : modelId.trim() === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`${menuItemClass} ${selected ? 'bg-zinc-800/60' : ''}`}
                  onClick={() => handlePick(p.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-left font-medium text-zinc-100">
                    {p.label}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500">{p.id}</span>
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
                    {selected ? <Check className="h-3.5 w-3.5 text-zinc-400" strokeWidth={2} /> : null}
                  </span>
                </button>
              );
            })}

            <div className="my-0.5 border-t border-zinc-800/80 px-0.5 pt-0.5">
              {!addOpen ? (
                <button
                  type="button"
                  className={`${menuItemClass} text-zinc-400`}
                  onClick={() => {
                    setAddOpen(true);
                    setAddError(null);
                  }}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                  Add model…
                </button>
              ) : (
                <div className="space-y-1.5 px-1.5 py-1.5">
                  <p className="text-[10px] leading-snug text-zinc-500">
                    Id from <code className="text-zinc-400">claude --help</code> etc.
                  </p>
                  <input
                    value={addId}
                    onChange={(e) => setAddId(e.target.value)}
                    placeholder="Model id"
                    className="w-full rounded border border-zinc-800/90 bg-zinc-950/80 px-1.5 py-1 font-mono text-[11px] text-zinc-200 outline-none focus-visible:border-zinc-600 focus-visible:ring-1 focus-visible:ring-zinc-600/30"
                  />
                  <input
                    value={addLabel}
                    onChange={(e) => setAddLabel(e.target.value)}
                    placeholder="Label (optional)"
                    className="w-full rounded border border-zinc-800/90 bg-zinc-950/80 px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus-visible:border-zinc-600 focus-visible:ring-1 focus-visible:ring-zinc-600/30"
                  />
                  {addError ? <p className="text-[10px] text-red-400/90">{addError}</p> : null}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={handleAdd}
                      className="inline-flex h-7 flex-1 items-center justify-center rounded bg-zinc-100 px-2 text-[11px] font-medium text-zinc-900 transition hover:bg-zinc-200"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddOpen(false);
                        setAddId('');
                        setAddLabel('');
                        setAddError(null);
                      }}
                      className="inline-flex h-7 flex-1 items-center justify-center rounded border border-zinc-800/80 bg-transparent px-2 text-[11px] text-zinc-400 transition hover:bg-zinc-800/40"
                    >
                      Cancel
                    </button>
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
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span className="min-w-0 flex-1 truncate text-left font-normal">{displayLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {listbox}
    </div>
  );
}
