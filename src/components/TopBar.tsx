import type { ReactNode } from 'react';
import type { Project } from '../types';
import { shellDivider } from '@/components/shell/shellNavStyles';
import { cn } from '@/lib/utils';

interface TopBarProps {
  project: Project;
  statusLine: string;
  /** Adds a leading inset so tabs don't collide with the floating expand button. */
  leadingInset?: boolean;
  children?: ReactNode;
}

export function TopBar({ project, statusLine, leadingInset, children }: TopBarProps) {
  return (
    <header
      className={cn(
        'flex shrink-0 items-center gap-3 border-b bg-background/80 px-3 py-1.5 backdrop-blur-md',
        shellDivider,
      )}
      aria-label={`Project: ${project.name}`}
    >
      <div className={cn('flex min-w-0 flex-1 items-center', leadingInset && 'pl-9')}>
        {children}
      </div>
      <p className="shrink-0 pl-4 text-[11px] tabular-nums text-muted-foreground">{statusLine}</p>
    </header>
  );
}
