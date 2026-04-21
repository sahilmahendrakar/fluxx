import type { ReactNode } from 'react';
import type { Project } from '../types';

interface TopBarProps {
  project: Project;
  statusLine: string;
  children?: ReactNode;
}

export function TopBar({ project, statusLine, children }: TopBarProps) {
  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#09090b]/80 px-3 py-1.5 backdrop-blur-md"
      aria-label={`Project: ${project.name}`}
    >
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      <p className="shrink-0 pl-4 text-[11px] tabular-nums text-zinc-600">{statusLine}</p>
    </header>
  );
}
