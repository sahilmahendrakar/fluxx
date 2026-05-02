import { useEffect, useId, useRef, useState } from 'react';
import { ListFilter, Search, X } from 'lucide-react';
import type { Agent, TaskStatus } from '../types';
import { AGENTS, COLUMNS } from '../types';
import {
  type BoardFilterState,
  boardFiltersAreActive,
  DEFAULT_BOARD_FILTER,
  UNLABELED_VALUE,
} from '../boardFilter';

const agentLabel = (id: Agent) => AGENTS.find((a) => a.id === id)?.label ?? id;

const statusLabel = (id: TaskStatus) => COLUMNS.find((c) => c.id === id)?.label ?? id;

function FilterToken({
  onRemove,
  k,
  v,
  title,
}: {
  onRemove: () => void;
  k: string;
  v: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex max-w-[min(100%,14rem)] shrink-0 items-center gap-0.5 rounded border border-sky-500/20 bg-sky-950/35 pl-2 pr-0.5 text-[11px] leading-tight text-sky-100/90"
    >
      <span className="min-w-0 truncate">
        <span className="text-sky-400/80">{k}</span>
        <span className="text-zinc-500"> = </span>
        <span className="text-zinc-200">{v}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
        aria-label={`Remove ${k} filter`}
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </span>
  );
}

type AddPanel = 'main' | 'agent' | 'label' | 'status';

type Props = {
  filter: BoardFilterState;
  onFilterChange: (next: BoardFilterState) => void;
  labelOptions: string[];
  doneHiddenCount: number;
};

export function BoardFilterBar({
  filter,
  onFilterChange,
  labelOptions,
  doneHiddenCount,
}: Props) {
  const inputId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<AddPanel>('main');
  const wrapRef = useRef<HTMLDivElement>(null);

  const hasActive = boardFiltersAreActive(filter);
  const set = (patch: Partial<BoardFilterState>) => {
    onFilterChange({ ...filter, ...patch });
  };

  useEffect(() => {
    if (!menuOpen) return;
    setPanel('main');
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [menuOpen]);

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <div
        className="flex min-h-[2.25rem] w-full min-w-0 items-center gap-1.5 rounded-md border border-zinc-800/90 bg-zinc-950/60 py-1 pl-2 pr-1 shadow-sm shadow-black/20"
        role="search"
      >
        <div className="flex min-h-[1.5rem] min-w-0 flex-1 items-center gap-1.5">
          <Search
            className="h-3.5 w-3.5 shrink-0 text-zinc-500"
            strokeWidth={2}
            aria-hidden
          />
          <input
            id={inputId}
            type="search"
            value={filter.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Filter by keyword…"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 border-0 bg-transparent py-0.5 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-0"
          />
        </div>
        <div
          className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5 pl-0.5"
        >
        {filter.agent !== 'all' ? (
          <FilterToken
            k="agent"
            v={agentLabel(filter.agent)}
            onRemove={() => set({ agent: 'all' })}
          />
        ) : null}
        {filter.status !== 'all' ? (
          <FilterToken
            k="status"
            v={statusLabel(filter.status)}
            onRemove={() => set({ status: 'all' })}
          />
        ) : null}
        {filter.label != null ? (
          <FilterToken
            k="label"
            v={
              filter.label === UNLABELED_VALUE
                ? 'Unlabeled'
                : filter.label
            }
            onRemove={() => set({ label: null })}
          />
        ) : null}
        {filter.hideDone ? (
          <FilterToken
            k="done"
            v="hidden"
            title={
              doneHiddenCount > 0
                ? `${doneHiddenCount} done task(s) not shown`
                : 'Hiding done tasks'
            }
            onRemove={() => set({ hideDone: false })}
          />
        ) : null}
        {!filter.includeDescription ? (
          <FilterToken
            k="searchIn"
            v="title"
            onRemove={() => set({ includeDescription: true })}
          />
        ) : null}
          {hasActive ? (
            <button
              type="button"
              onClick={() => onFilterChange({ ...DEFAULT_BOARD_FILTER })}
              className="rounded px-1.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-300"
            >
              Clear
            </button>
          ) : null}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-800/80 hover:text-zinc-300"
              title="Add filter"
              aria-expanded={menuOpen}
              aria-haspopup="listbox"
            >
              <ListFilter className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            {menuOpen ? (
              <div
                className="absolute right-0 top-full z-50 mt-1 w-56 max-h-72 origin-top-right overflow-hidden rounded-md border border-zinc-800 bg-[#0e0e11] py-1 shadow-lg shadow-black/50"
                role="listbox"
              >
                {panel === 'main' ? (
                  <>
                    <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      Add filter
                    </p>
                    <button
                      type="button"
                      onClick={() => setPanel('agent')}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                    >
                      Agent
                      <span className="text-zinc-500">›</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPanel('label')}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                    >
                      Label
                      <span className="text-zinc-500">›</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPanel('status')}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                    >
                      Status
                      <span className="text-zinc-500">›</span>
                    </button>
                    {filter.includeDescription ? (
                      <button
                        type="button"
                        onClick={() => {
                          set({ includeDescription: false });
                          setMenuOpen(false);
                        }}
                        className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                      >
                        Title only (search)
                      </button>
                    ) : null}
                    {!filter.hideDone ? (
                      <button
                        type="button"
                        onClick={() => {
                          set({ hideDone: true });
                          setMenuOpen(false);
                        }}
                        className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                      >
                        Hide done
                      </button>
                    ) : null}
                  </>
                ) : null}
                {panel === 'agent' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPanel('main')}
                      className="flex w-full items-center gap-1.5 border-b border-zinc-800/80 px-2.5 py-1.5 text-left text-[11px] text-zinc-500 hover:bg-zinc-800/50"
                    >
                      ‹ Back
                    </button>
                    {AGENTS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          set({ agent: a.id });
                          setMenuOpen(false);
                        }}
                        className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                      >
                        {a.label}
                      </button>
                    ))}
                  </>
                ) : null}
                {panel === 'status' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPanel('main')}
                      className="flex w-full items-center gap-1.5 border-b border-zinc-800/80 px-2.5 py-1.5 text-left text-[11px] text-zinc-500 hover:bg-zinc-800/50"
                    >
                      ‹ Back
                    </button>
                    {COLUMNS.map((col) => (
                      <button
                        key={col.id}
                        type="button"
                        onClick={() => {
                          set({ status: col.id });
                          setMenuOpen(false);
                        }}
                        className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                      >
                        {col.label}
                      </button>
                    ))}
                  </>
                ) : null}
                {panel === 'label' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPanel('main')}
                      className="flex w-full items-center gap-1.5 border-b border-zinc-800/80 px-2.5 py-1.5 text-left text-[11px] text-zinc-500 hover:bg-zinc-800/50"
                    >
                      ‹ Back
                    </button>
                    <div className="max-h-40 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          set({ label: UNLABELED_VALUE });
                          setMenuOpen(false);
                        }}
                        className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                      >
                        Unlabeled
                      </button>
                      {labelOptions.map((lab) => (
                        <button
                          key={lab}
                          type="button"
                          onClick={() => {
                            set({ label: lab });
                            setMenuOpen(false);
                          }}
                          className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                        >
                          {lab}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
        </div>
        </div>
      </div>
    </div>
  );
}
