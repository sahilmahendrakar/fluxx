import { ChevronDown } from 'lucide-react';
import type { ShellPlacement } from '../types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface SessionShellAddMenuProps {
  running: boolean;
  localWorktreeAvailable: boolean;
  onOpenShell: (placement: ShellPlacement) => void | Promise<void>;
}

export function SessionShellAddMenu({
  running,
  localWorktreeAvailable,
  onOpenShell,
}: SessionShellAddMenuProps) {
  const disabled = !running;

  return (
    <div className="ml-1 flex shrink-0 items-stretch">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={() => running && void onOpenShell('remote')}
        title={running ? 'Open SSH terminal in remote worktree' : 'Session is not running'}
        aria-label="Open SSH terminal"
        className={cn(
          'size-6 rounded-l-md rounded-r-none text-base leading-none',
          running
            ? 'text-status-terminal-foreground/70 hover:bg-status-terminal-foreground/10 hover:text-status-terminal-foreground'
            : 'text-status-terminal-foreground/30',
        )}
      >
        +
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Choose terminal type"
            title="SSH or local terminal"
            className={cn(
              'size-6 w-5 rounded-l-none rounded-r-md border-l border-status-terminal-foreground/10',
              running
                ? 'text-status-terminal-foreground/55 hover:bg-status-terminal-foreground/10 hover:text-status-terminal-foreground'
                : 'text-status-terminal-foreground/30',
            )}
          >
            <ChevronDown className="size-3" strokeWidth={2.5} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem
            disabled={!running}
            onClick={() => onOpenShell('remote')}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="text-[12px] font-medium">SSH terminal</span>
            <span className="text-[11px] text-muted-foreground">Remote worktree on SSH device</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!running || !localWorktreeAvailable}
            onClick={() => onOpenShell('local')}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="text-[12px] font-medium">Local terminal</span>
            <span className="text-[11px] text-muted-foreground">
              {localWorktreeAvailable
                ? 'Synced worktree on this Mac'
                : 'Sync to local first'}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
