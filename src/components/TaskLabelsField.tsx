import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { ChevronDown, X } from 'lucide-react';
import { normalizeTaskLabels } from '../taskLabels';

const listRowClass =
  'flex w-full items-center text-left text-[12px] text-zinc-200 transition hover:bg-white/[0.06]';

const MAX_SUGGESTIONS = 14;

type Row = { kind: 'pick'; label: string } | { kind: 'create'; value: string };

type Props = {
  idPrefix: string;
  labels: string[];
  /** Labels used elsewhere in the project (and on this task) for the suggestion list. */
  labelCatalog: string[];
  onLabelsChange: (next: string[]) => void;
  compact?: boolean;
  /** Match task detail panel subsection labels (`text-xs` / zinc-500). */
  variant?: 'default' | 'panel';
};

function rowsForQuery(
  query: string,
  selected: string[],
  catalog: string[],
): Row[] {
  const selectedLower = new Set(selected.map((s) => s.toLowerCase()));
  const available = catalog.filter((c) => !selectedLower.has(c.toLowerCase()));
  const q = query.trim().toLowerCase();
  const filtered =
    q === ''
      ? available
      : available.filter((c) => c.toLowerCase().includes(q));
  const picks: Row[] = filtered.slice(0, MAX_SUGGESTIONS).map((label) => ({
    kind: 'pick' as const,
    label,
  }));
  const qTrim = query.trim();
  const canCreate =
    qTrim.length > 0 &&
    !selectedLower.has(qTrim.toLowerCase()) &&
    !catalog.some((c) => c.toLowerCase() === qTrim.toLowerCase());
  if (canCreate) {
    picks.push({ kind: 'create', value: qTrim });
  }
  return picks;
}

/**
 * Pick labels from a project catalog or create new ones; values are normalized on commit.
 */
export function TaskLabelsField({
  idPrefix,
  labels,
  labelCatalog,
  onLabelsChange,
  compact = false,
  variant = 'default',
}: Props) {
  const baseId = useId();
  const listboxId = `${idPrefix}-${baseId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const commitLabels = useCallback(
    (next: string[]) => {
      onLabelsChange(normalizeTaskLabels(next));
    },
    [onLabelsChange],
  );

  const rows = useMemo(
    () => rowsForQuery(query, labels, labelCatalog),
    [query, labels, labelCatalog],
  );

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    setHighlight((h) => (rows.length === 0 ? 0 : Math.min(h, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const addLabel = useCallback(
    (raw: string) => {
      const t = raw.trim();
      if (t === '') return;
      commitLabels([...labels, t]);
      setQuery('');
      setOpen(false);
      inputRef.current?.focus();
    },
    [labels, commitLabels],
  );

  const removeLabel = useCallback(
    (label: string) => {
      commitLabels(labels.filter((x) => x !== label));
    },
    [labels, commitLabels],
  );

  const applyRow = useCallback(
    (row: Row) => {
      if (row.kind === 'pick') {
        addLabel(row.label);
      } else {
        addLabel(row.value);
      }
    },
    [addLabel],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && query === '' && labels.length > 0) {
      e.preventDefault();
      commitLabels(labels.slice(0, -1));
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => (rows.length === 0 ? 0 : (h + 1) % rows.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) =>
        rows.length === 0 ? 0 : (h - 1 + rows.length) % rows.length,
      );
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && rows[highlight]) {
        applyRow(rows[highlight]);
        return;
      }
      if (query.trim() !== '') {
        const q = query.trim();
        const exact = labelCatalog.find(
          (c) => c.toLowerCase() === q.toLowerCase(),
        );
        const already = labels.some((l) => l.toLowerCase() === q.toLowerCase());
        if (exact && !already) {
          addLabel(exact);
          return;
        }
        if (
          !already &&
          !labelCatalog.some((c) => c.toLowerCase() === q.toLowerCase())
        ) {
          addLabel(q);
        }
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const showMenu = open && rows.length > 0;
  const padding = compact ? 'px-2 py-1' : 'px-2.5 py-1.5';
  const chipText = compact ? 'text-[10px]' : 'text-[11px]';
  const inputText = compact ? 'text-[11px]' : 'text-[12px]';

  return (
    <div ref={rootRef} className="relative">
      <label
        htmlFor={`${idPrefix}-combo`}
        className={
          compact
            ? 'mb-1.5 block text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-500'
            : variant === 'panel'
              ? 'mb-1.5 block text-xs text-zinc-500'
              : 'mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500'
        }
      >
        Labels
      </label>

      <div
        className={
          compact
            ? 'flex min-h-[36px] flex-wrap items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#0c0c0e] p-1.5'
            : 'flex min-h-[44px] flex-wrap items-center gap-2 rounded-md border border-white/[0.1] bg-[#0c0c0e] p-1.5'
        }
      >
        {labels.map((lb) => (
          <span
            key={lb}
            className={`group/chip inline-flex max-w-full items-center gap-0.5 rounded-full border border-violet-400/25 ${chipText} bg-gradient-to-b from-violet-500/20 to-violet-600/10 pl-2.5 pr-0.5 font-medium text-violet-100 shadow-sm ring-1 ring-inset ring-violet-400/10 transition hover:border-violet-300/35 hover:from-violet-500/25`}
          >
            <span className="min-w-0 truncate" title={lb}>
              {lb}
            </span>
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-violet-300/70 transition hover:bg-violet-500/25 hover:text-violet-100"
              aria-label={`Remove ${lb}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => removeLabel(lb)}
            >
              <X className="h-3 w-3" strokeWidth={2.25} />
            </button>
          </span>
        ))}

        <div
          className={`flex min-w-0 flex-1 items-stretch ${compact ? 'min-h-[28px]' : 'min-h-[32px]'} ${
            !labels.length ? 'w-full' : 'min-w-[7rem] flex-1 sm:min-w-[9rem]'
          }`}
        >
          <div
            className={`flex w-full min-w-0 items-center gap-1.5 rounded-md border border-white/[0.1] bg-[#09090b] ${padding} outline-none transition focus-within:border-white/[0.16] focus-within:ring-1 focus-within:ring-white/[0.1]`}
          >
            <input
              ref={inputRef}
              id={`${idPrefix}-combo`}
              type="text"
              value={query}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onKeyDown={onKeyDown}
              onFocus={() => setOpen(true)}
              placeholder={labels.length ? 'Add…' : 'Label…'}
              className={`min-w-0 flex-1 border-none bg-transparent ${inputText} leading-snug text-zinc-100 outline-none placeholder:text-zinc-600`}
            />
            <button
              type="button"
              tabIndex={-1}
              className="flex shrink-0 items-center justify-center rounded p-0.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
              aria-label="Toggle label suggestions"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen((o) => !o);
                inputRef.current?.focus();
              }}
            >
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 ${open ? 'rotate-180' : ''} transition`}
                strokeWidth={1.75}
              />
            </button>
          </div>
        </div>
      </div>

      {showMenu ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-[200] mt-1 max-h-[min(14rem,40vh)] overflow-y-auto overflow-x-hidden rounded-md border border-white/[0.1] bg-[#121214] py-0.5 shadow-xl shadow-black/50"
        >
          {rows.map((row, i) => {
            const active = i === highlight;
            const rowPad = compact ? 'px-2 py-1' : 'px-2.5 py-1.5';
            if (row.kind === 'create') {
              return (
                <button
                  key="create"
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => applyRow(row)}
                  className={`${listRowClass} ${rowPad} ${
                    active ? 'bg-white/[0.08]' : ''
                  } `}
                >
                  <span className="shrink-0 text-zinc-500">+</span>
                  <span className="min-w-0">
                    <span className="text-zinc-500">Create </span>
                    <span className="text-zinc-200">&ldquo;{row.value}&rdquo;</span>
                  </span>
                </button>
              );
            }
            return (
              <button
                key={row.label}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => applyRow(row)}
                className={`${listRowClass} ${rowPad} ${
                  active ? 'bg-white/[0.08]' : ''
                } `}
              >
                <span className="min-w-0 flex-1 truncate text-zinc-200">
                  {row.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!compact && variant !== 'panel' ? (
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Pick from the list or type a new name.
        </p>
      ) : null}
    </div>
  );
}
