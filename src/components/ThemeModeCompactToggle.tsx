import { useFluxTheme } from '../renderer/FluxThemeProvider';
import type { ThemeMode } from '../renderer/theme';

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="8" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1.25v1.5M8 13.25v1.5M14.75 8h-1.5M2.75 8H1.25m11.35-4.6-1.06 1.06M4.46 11.54l-1.06 1.06m9.2-.94-1.06-1.06M4.46 4.46L3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M9.25 1.75A6.25 6.25 0 1 0 14.25 11a5.15 5.15 0 0 1-5-9.25Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type ThemeModeCompactToggleProps = {
  className?: string;
};

/** One-click light/dark toggle; persists via `FluxThemeProvider`. */
export function ThemeModeCompactToggle({ className }: ThemeModeCompactToggleProps) {
  const { theme, setTheme } = useFluxTheme();
  const isLight = theme === 'light';
  const nextMode: ThemeMode = isLight ? 'dark' : 'light';
  const label = isLight ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <button
      type="button"
      onClick={() => setTheme(nextMode)}
      aria-label={label}
      title={label}
      aria-pressed={isLight}
      className={className}
    >
      {isLight ? <MoonIcon className="opacity-90" /> : <SunIcon className="opacity-90" />}
    </button>
  );
}
