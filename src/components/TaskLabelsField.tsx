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

/** Match AgentModelPicker trigger + shadcn-style combobox. */
const comboboxSurfaceClass =
  'flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-flux-border/12 bg-flux-surface px-2 py-1 text-[12px] outline-none ring-0 transition hover:border-flux-border/20 focus-within:border-flux-border/25 focus-within:ring-1 focus-within:ring-flux-ring/20';

const comboboxSurfaceClassCompact =
  'min-h-8 gap-0.5 px-1.5 py-0.5 text-[11px]';

const listboxPanelClass =
  'absolute left-0 right-0 z-[200] mt-1 max-h-[min(14rem,40vh)] overflow-y-auto overflow-x-hidden rounded-md border border-flux-border/12 bg-flux-elevated py-1 shadow-xl shadow-black/25';

const listRowClass =
  'flex w-full items-center rounded-sm px-2.5 py-1.5 text-left text-[12px] text-flux-fg-muted outline-none transition hover:bg-flux-hover/8';

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
  const isPanel = variant === 'panel';
  const chipText = compact ? 'text-[10px]' : 'text-xs';
  const inputText = compact ? 'text-[11px]' : 'text-[12px]';
  const chipClass = compact
    ? `group/chip inline-flex max-w-full items-center gap-0.5 rounded-md border border-flux-border/12 bg-flux-hover/6 py-0.5 pl-1.5 pr-0.5 ${chipText} font-medium text-flux-fg-muted transition hover:bg-flux-hover/10`
    : `group/chip inline-flex max-w-full items-center gap-0.5 rounded-md border border-flux-border/12 bg-flux-hover/6 pl-1.5 pr-0.5 ${chipText} font-medium text-flux-fg-muted transition hover:bg-flux-hover/8`;
  const chevronClass = compact
    ? 'h-3 w-3'
    : 'h-3.5 w-3.5';
  const removeBtnClass = compact
    ? 'h-3.5 w-3.5'
    : 'h-4 w-4';
  const comboboxClass = [comboboxSurfaceClass, compact && comboboxSurfaceClassCompact]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={rootRef} className="relative">
      <label
        htmlFor={`${idPrefix}-combo`}
        className={
          compact
            ? 'mb-1.5 block text-[10px] font-medium uppercase tracking-[0.1em] text-flux-fg-subtle'
            : isPanel
              ? 'mb-1.5 block text-xs font-normal text-flux-fg-subtle'
              : 'mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-flux-fg-subtle'
        }
      >
        Labels
      </label>

      <div className={comboboxClass}>
        {labels.map((lb) => (
          <span key={lb} className={chipClass}>
            <span className="min-w-0 truncate" title={lb}>
              {lb}
            </span>
            <button
              type="button"
              className={`flex ${removeBtnClass} shrink-0 items-center justify-center rounded-sm text-flux-fg-subtle transition hover:bg-flux-hover/10 hover:text-flux-fg`}
              aria-label={`Remove ${lb}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => removeLabel(lb)}
            >
              <X className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={2} />
            </button>
          </span>
        ))}

        <div
          className={`flex min-w-0 flex-1 items-center gap-0.5 ${
            !labels.length ? 'w-full' : 'min-w-0 sm:min-w-[5.5rem]'
          }`}
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
            placeholder={labels.length ? 'Add…' : 'Add labels…'}
            className={`min-w-0 flex-1 border-none bg-transparent ${inputText} leading-normal text-flux-fg outline-none placeholder:text-flux-fg-subtle`}
          />
          <button
            type="button"
            tabIndex={-1}
            className="flex shrink-0 items-center justify-center rounded-sm p-0.5 text-flux-fg-subtle transition hover:bg-flux-hover/8 hover:text-flux-fg-muted"
            aria-label="Toggle label suggestions"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen((o) => !o);
              inputRef.current?.focus();
            }}
          >
            <ChevronDown
              className={`shrink-0 text-flux-fg-subtle ${chevronClass} ${open ? 'rotate-180' : ''} transition-transform`}
              strokeWidth={1.75}
            />
          </button>
        </div>
      </div>

      {showMenu ? (
        <div
          id={listboxId}
          role="listbox"
          className={listboxPanelClass}
        >
          {rows.map((row, i) => {
            const active = i === highlight;
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
                  className={`${listRowClass} ${
                    active ? 'bg-flux-hover/8' : ''
                  } `}
                >
                  <span className="shrink-0 pr-1.5 text-flux-fg-subtle" aria-hidden>
                    +
                  </span>
                  <span className="min-w-0 text-left">
                    <span className="text-flux-fg-subtle">Create &ldquo;</span>
                    <span className="text-flux-fg-muted">{row.value}</span>
                    <span className="text-flux-fg-subtle">&rdquo;</span>
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
                className={`${listRowClass} ${
                  active ? 'bg-flux-hover/8' : ''
                } `}
              >
                <span className="min-w-0 flex-1 truncate font-medium text-flux-fg-muted">
                  {row.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!compact && variant !== 'panel' ? (
        <p className="mt-1.5 text-[11px] text-flux-fg-subtle">
          Pick from the list or type a new name.
        </p>
      ) : null}
    </div>
  );
}
