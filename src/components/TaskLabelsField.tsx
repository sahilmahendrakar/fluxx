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
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { normalizeTaskLabels } from '../taskLabels';

const comboboxSurfaceClass =
  'flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs outline-none transition focus-within:ring-1 focus-within:ring-ring';

const comboboxSurfaceClassCompact = 'min-h-8 gap-0.5 px-1.5 py-0.5 text-[11px]';

const listboxPanelClass =
  'absolute left-0 right-0 z-[200] mt-1 max-h-[min(14rem,40vh)] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md';

const listRowClass =
  'flex w-full items-center rounded-sm px-2.5 py-1.5 text-left text-xs text-popover-foreground outline-none transition hover:bg-accent hover:text-accent-foreground';

const MAX_SUGGESTIONS = 14;

type Row = { kind: 'pick'; label: string } | { kind: 'create'; value: string };

type Props = {
  idPrefix: string;
  labels: string[];
  /** Labels used elsewhere in the project (and on this task) for the suggestion list. */
  labelCatalog: string[];
  onLabelsChange: (next: string[]) => void;
  compact?: boolean;
  /** Match task detail panel subsection labels (`text-xs` / muted). */
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
    q === '' ? available : available.filter((c) => c.toLowerCase().includes(q));
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
      setHighlight((h) => (rows.length === 0 ? 0 : (h - 1 + rows.length) % rows.length));
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
        const exact = labelCatalog.find((c) => c.toLowerCase() === q.toLowerCase());
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
  const inputText = compact ? 'text-[11px]' : 'text-xs';
  const chipClass = cn(
    'group/chip inline-flex max-w-full items-center gap-0.5 rounded-md border border-border bg-muted/60 font-medium text-foreground transition hover:bg-muted',
    compact ? 'py-0.5 pl-1.5 pr-0.5' : 'pl-1.5 pr-0.5',
    chipText,
  );
  const chevronClass = compact ? 'size-3' : 'size-3.5';
  const removeBtnClass = compact ? 'size-3.5' : 'size-4';
  const comboboxClass = cn(comboboxSurfaceClass, compact && comboboxSurfaceClassCompact);

  const labelClass = compact
    ? 'mb-1.5 block text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground'
    : isPanel
      ? 'mb-1.5 text-xs font-normal text-muted-foreground'
      : 'mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground';

  return (
    <div ref={rootRef} className="relative">
      <Label htmlFor={`${idPrefix}-combo`} className={labelClass}>
        Labels
      </Label>

      <div className={comboboxClass}>
        {labels.map((lb) => (
          <span key={lb} className={chipClass}>
            <span className="min-w-0 truncate" title={lb}>
              {lb}
            </span>
            <button
              type="button"
              className={cn(
                'flex shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-accent hover:text-foreground',
                removeBtnClass,
              )}
              aria-label={`Remove ${lb}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => removeLabel(lb)}
            >
              <X className={compact ? 'size-2.5' : 'size-3'} strokeWidth={2} />
            </button>
          </span>
        ))}

        <div
          className={cn(
            'flex min-w-0 flex-1 items-center gap-0.5',
            !labels.length ? 'w-full' : 'min-w-0 sm:min-w-[5.5rem]',
          )}
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
            className={cn(
              'min-w-0 flex-1 border-none bg-transparent leading-normal text-foreground outline-none placeholder:text-muted-foreground',
              inputText,
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tabIndex={-1}
            className="size-6 shrink-0 text-muted-foreground"
            aria-label="Toggle label suggestions"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen((o) => !o);
              inputRef.current?.focus();
            }}
          >
            <ChevronDown
              className={cn('shrink-0 transition-transform', chevronClass, open && 'rotate-180')}
              strokeWidth={1.75}
            />
          </Button>
        </div>
      </div>

      {showMenu ? (
        <div id={listboxId} role="listbox" className={listboxPanelClass}>
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
                  className={cn(listRowClass, active && 'bg-accent')}
                >
                  <span className="shrink-0 pr-1.5 text-muted-foreground" aria-hidden>
                    +
                  </span>
                  <span className="min-w-0 text-left">
                    <span className="text-muted-foreground">Create &ldquo;</span>
                    <span className="text-foreground">{row.value}</span>
                    <span className="text-muted-foreground">&rdquo;</span>
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
                className={cn(listRowClass, active && 'bg-accent')}
              >
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {row.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!compact && variant !== 'panel' ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Pick from the list or type a new name.
        </p>
      ) : null}
    </div>
  );
}
