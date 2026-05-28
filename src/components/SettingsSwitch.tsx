import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

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
  const sm = size === 'sm';
  return (
    <Switch
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-labelledby={ariaLabelledBy}
      aria-busy={ariaBusy || undefined}
      className={cn(sm && 'h-5 w-8 [&>span]:h-3.5 [&>span]:w-3.5 [&>span]:data-[state=checked]:translate-x-3')}
    />
  );
}
