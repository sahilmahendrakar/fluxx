import type { ReactNode } from 'react';
import type { Project } from '../types';

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
      className="flex shrink-0 items-center gap-3 border-b border-flux-border/10 bg-flux-canvas/80 px-3 py-1.5 backdrop-blur-md"
      aria-label={`Project: ${project.name}`}
    >
      <div
        className={[
          'flex min-w-0 flex-1 items-center',
          leadingInset ? 'pl-9' : '',
        ].join(' ')}
      >
        {children}
      </div>
      <p className="shrink-0 pl-4 text-[11px] tabular-nums text-flux-fg-subtle">{statusLine}</p>
    </header>
  );
}
