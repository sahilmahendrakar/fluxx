import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import type { AgentModelUiKind } from '../agentModelUi';
import {
  appendAgentModelExtra,
  choicesForPicker,
  labelForModelId,
} from '../agentModelUi';

const menuItemClass =
  'flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] text-zinc-200 transition hover:bg-white/[0.06]';

const triggerClass =
  'flex min-h-[2rem] w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-md border border-white/[0.1] bg-[#09090b] px-2 py-1 text-left text-[12px] text-zinc-200 outline-none ring-0 transition hover:border-white/[0.14] focus-visible:border-white/[0.18] focus-visible:ring-1 focus-visible:ring-white/[0.12]';

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

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) {
        closeAll();
      }
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

  return (
    <div ref={rootRef} className="relative min-w-0 max-w-[13rem] flex-1 sm:max-w-[16rem]">
      <button
        type="button"
        className={triggerClass}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">{displayLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          className="absolute left-0 right-0 z-50 mt-1 max-h-[min(20rem,calc(100vh-8rem))] overflow-y-auto rounded-md border border-white/[0.1] bg-[#121214] py-1 shadow-xl shadow-black/50"
          role="listbox"
          aria-label={ariaLabel}
        >
          {kind === 'claude-code' ? (
            <button
              type="button"
              role="option"
              aria-selected={!modelId.trim()}
              className={`${menuItemClass} ${!modelId.trim() ? 'bg-white/[0.06]' : ''}`}
              onClick={() => handlePick('')}
            >
              <span className="font-medium text-zinc-100">Default</span>
              <span className="ml-auto shrink-0 text-[11px] text-zinc-500">CLI & project</span>
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
                className={`${menuItemClass} ${selected ? 'bg-white/[0.06]' : ''}`}
                onClick={() => handlePick(p.id)}
              >
                <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">{p.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-500">{p.id}</span>
              </button>
            );
          })}

          <div className="mx-1 my-1 border-t border-white/[0.08] pt-1">
            {!addOpen ? (
              <button
                type="button"
                className={`${menuItemClass} text-zinc-300`}
                onClick={() => {
                  setAddOpen(true);
                  setAddError(null);
                }}
              >
                <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                Add model…
              </button>
            ) : (
              <div className="space-y-2 px-2 py-2">
                <p className="text-[11px] leading-snug text-zinc-500">
                  Add a model id your CLI accepts (e.g. from <code className="text-zinc-400">agent models</code> or{' '}
                  <code className="text-zinc-400">claude --help</code>).
                </p>
                <input
                  value={addId}
                  onChange={(e) => setAddId(e.target.value)}
                  placeholder="Model id"
                  className="w-full rounded border border-white/[0.1] bg-[#09090b] px-2 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus-visible:border-white/[0.2]"
                />
                <input
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="Display name (optional)"
                  className="w-full rounded border border-white/[0.1] bg-[#09090b] px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus-visible:border-white/[0.2]"
                />
                {addError ? <p className="text-[11px] text-red-300/90">{addError}</p> : null}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={handleAdd}
                    className="rounded border border-emerald-500/25 bg-emerald-500/[0.1] px-2 py-1 text-[11px] font-medium text-emerald-100/90 transition hover:bg-emerald-500/[0.14]"
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
                    className="rounded px-2 py-1 text-[11px] text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
