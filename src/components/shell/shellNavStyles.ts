import { cn } from '@/lib/utils';

/** Faint dividers between shell regions (sidebar, top bar, footer). */
export const shellDivider = 'border-border/40';

/** Slightly softer corners for shell interactive surfaces. */
export const shellRadius = 'rounded-lg';

/** Left-aligned label buttons in the sidebar (not icon-only controls). */
export const shellSidebarLabelButton = 'justify-start text-left font-normal';

/** Faint fill for selected sidebar / nav rows (overrides ghost `hover:bg-accent`). */
export const shellNavActiveClass = 'bg-muted/40 text-foreground';

/** Subtle hover for sidebar ghost rows. */
export const shellNavHoverClass = 'hover:bg-muted/30 hover:text-foreground';

/** Secondary sidebar labels and inactive nav — darker in light mode. */
export const shellMutedTextClass = 'text-foreground/80 dark:text-muted-foreground';

/** Bordered chips/cards: deepen edge on hover instead of brightening fill. */
export const shellBorderDeepenHoverClass =
  'transition-[border-color,box-shadow] hover:border-foreground/30 hover:shadow-none';

/** Sidebar nav row — use with `Button variant="ghost" size="sm"`. */
export function shellNavButtonClass(active: boolean) {
  return cn(
    'w-full',
    shellRadius,
    shellSidebarLabelButton,
    active ? shellNavActiveClass : cn(shellMutedTextClass, shellNavHoverClass),
  );
}

/** Docs file list row — use with `Button variant="ghost" size="sm"`. */
export function shellNavFileRowClass(active: boolean) {
  return cn(
    'h-7 w-full gap-1 px-2 font-mono text-[11px]',
    shellRadius,
    shellSidebarLabelButton,
    active ? shellNavActiveClass : cn(shellMutedTextClass, shellNavHoverClass),
  );
}

/** Active background for a nav row with a trailing control (e.g. Docs chevron). */
export function shellNavRowClass(active: boolean) {
  return cn(
    'flex w-full items-center justify-start',
    shellRadius,
    active && shellNavActiveClass,
  );
}

/** Sidebar header icon control. */
export function shellIconButtonClass(active?: boolean) {
  return cn(
    'size-7 shrink-0',
    shellRadius,
    active ? shellNavActiveClass : cn(shellMutedTextClass, shellNavHoverClass),
  );
}
