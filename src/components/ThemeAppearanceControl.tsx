import { useFluxTheme } from '../renderer/FluxThemeProvider';
import type { ThemeMode } from '../renderer/theme';

function ModeButton({
  active,
  label,
  mode,
  onSelect,
}: {
  active: boolean;
  label: string;
  mode: ThemeMode;
  onSelect: (mode: ThemeMode) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(mode)}
      className={[
        'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
        active
          ? 'bg-flux-selected/12 text-flux-fg ring-1 ring-inset ring-flux-border/20'
          : 'text-flux-fg-muted hover:bg-flux-hover/8 hover:text-flux-fg',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

/** Segmented Dark / Light control; persists via `FluxThemeProvider`. */
export function ThemeAppearanceControl({
  className,
  labelledBy,
}: {
  className?: string;
  /** Optional id of a heading for accessibility. */
  labelledBy?: string;
}) {
  const { theme, setTheme } = useFluxTheme();

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className={[
        'inline-flex rounded-lg border border-flux-border/10 bg-flux-elevated/60 p-0.5',
        className ?? '',
      ].join(' ')}
    >
      <ModeButton active={theme === 'dark'} label="Dark" mode="dark" onSelect={setTheme} />
      <ModeButton active={theme === 'light'} label="Light" mode="light" onSelect={setTheme} />
    </div>
  );
}
