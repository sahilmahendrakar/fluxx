/**
 * Toggle used in project settings (planning / default task agent rows).
 */
export function SettingsSwitch({
  checked,
  onCheckedChange,
  disabled,
  ariaLabelledBy,
  ariaBusy,
  size = 'default',
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  /** Prefer wiring the row title via `id` + this prop for a concise switch name in assistive tech. */
  ariaLabelledBy?: string;
  /** True while loading prefs or persisting so assistive tech can announce activity. */
  ariaBusy?: boolean;
  size?: 'default' | 'sm';
}) {
  const busy = !!disabled;
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={ariaLabelledBy}
      aria-busy={ariaBusy || undefined}
      disabled={busy}
      onClick={() => {
        if (busy) return;
        onCheckedChange(!checked);
      }}
      className={[
        'relative inline-flex shrink-0 items-center rounded-full transition-colors',
        sm ? 'h-5 w-8 p-px' : 'h-6 w-10 p-0.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/[0.18] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]',
        checked ? 'justify-end bg-emerald-600' : 'justify-start bg-zinc-700',
        busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none block rounded-full bg-zinc-100 shadow-sm',
          sm ? 'h-3.5 w-3.5' : 'h-5 w-5',
        ].join(' ')}
      />
    </button>
  );
}
