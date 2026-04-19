import type { Project } from '../types';

interface TopBarProps {
  project: Project;
  title: string;
  statusLine: string;
}

export function TopBar({ project, title, statusLine }: TopBarProps) {
  return (
    <header
      className="flex shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#09090b]/80 px-5 py-2.5 backdrop-blur-md"
      aria-label={`Project: ${project.name}`}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="text-[13px] font-medium tracking-tight text-zinc-200">{title}</h1>
        <span className="hidden text-zinc-700 sm:inline" aria-hidden>
          ·
        </span>
        <span className="hidden truncate text-[13px] text-zinc-500 sm:inline" title={project.name}>
          {project.name}
        </span>
      </div>
      <p className="shrink-0 pl-4 text-[11px] tabular-nums text-zinc-600">{statusLine}</p>
    </header>
  );
}
