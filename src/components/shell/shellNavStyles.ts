import { cn } from '@/lib/utils';

/** Faint dividers between shell regions (sidebar, top bar, footer). */
export const shellDivider = 'border-border/40';

/** Slightly softer corners for shell interactive surfaces. */
export const shellRadius = 'rounded-lg';

/** Left-aligned label buttons in the sidebar (not icon-only controls). */
export const shellSidebarLabelButton = 'justify-start text-left font-normal';

/** Sidebar nav row — use with `Button variant="ghost" size="sm"`. */
export function shellNavButtonClass(active: boolean) {
  return cn(
    'w-full',
    shellRadius,
    shellSidebarLabelButton,
    active
      ? 'bg-accent text-accent-foreground'
      : 'text-muted-foreground',
  );
}

/** Docs file list row — use with `Button variant="ghost" size="sm"`. */
export function shellNavFileRowClass(active: boolean) {
  return cn(
    'h-7 w-full gap-1 px-2 font-mono text-[11px]',
    shellRadius,
    shellSidebarLabelButton,
    active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
  );
}

/** Active background for a nav row with a trailing control (e.g. Docs chevron). */
export function shellNavRowClass(active: boolean) {
  return cn(
    'flex w-full items-center justify-start',
    shellRadius,
    active && 'bg-accent text-accent-foreground',
  );
}

/** Sidebar header icon control. */
export function shellIconButtonClass(active?: boolean) {
  return cn(
    'size-7 shrink-0 text-muted-foreground',
    shellRadius,
    active && 'bg-accent text-accent-foreground',
  );
}
