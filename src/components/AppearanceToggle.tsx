import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  type AppearancePreference,
  APPEARANCE_PREFERENCE_LABELS,
} from '@/theme/appearance';
import { useAppearance } from '@/theme/ThemeProvider';

const MODES: AppearancePreference[] = ['light', 'dark', 'system'];

function activeModeIcon(preference: AppearancePreference) {
  if (preference === 'light') return Sun;
  if (preference === 'dark') return Moon;
  return Monitor;
}

interface AppearanceToggleProps {
  className?: string;
  /** Icon in the projects list header. */
  variant?: 'icon' | 'footer';
}

export function AppearanceToggle({ className, variant = 'icon' }: AppearanceToggleProps) {
  const { preference, setPreference } = useAppearance();
  const ActiveIcon = activeModeIcon(preference);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'footer' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto w-full justify-start gap-2 px-2 py-1.5 text-left font-normal text-muted-foreground hover:text-foreground',
              className,
            )}
          >
            <ActiveIcon className="size-4 shrink-0" />
            <span>Appearance</span>
            <span className="ml-auto text-[11px] text-muted-foreground/80">
              {APPEARANCE_PREFERENCE_LABELS[preference]}
            </span>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn('size-7', className)}
            aria-label="Appearance"
          >
            <ActiveIcon className="size-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={variant === 'footer' ? 'top' : 'bottom'}
        align={variant === 'footer' ? 'start' : 'end'}
        className="w-32 p-1 text-xs"
      >
        <DropdownMenuGroup>
          {MODES.map((mode) => (
            <DropdownMenuItem
              key={mode}
              className={cn(
                'px-2 py-1.5 text-xs',
                preference === mode && 'bg-accent text-accent-foreground',
              )}
              aria-current={preference === mode ? 'true' : undefined}
              onSelect={() => {
                void setPreference(mode);
              }}
            >
              {APPEARANCE_PREFERENCE_LABELS[mode]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
