import { useEffect, useState } from 'react';
import type { Project } from '../types';

interface ProjectsListViewProps {
  onProjectActivated: (project: Project) => void;
  authSlot?: React.ReactNode;
}

export function ProjectsListView({
  onProjectActivated,
  authSlot,
}: ProjectsListViewProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [gitError, setGitError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.projects
      .list()
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[projects.list] failed', err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAdd = async () => {
    setGitError(false);
    setAdding(true);
    try {
      const result = await window.electronAPI.projects.add();
      if (!result) return;
      if ('error' in result) {
        if (result.error === 'NOT_GIT_REPO') setGitError(true);
        return;
      }
      const active = await window.electronAPI.projects.activate(result.id);
      if (active) onProjectActivated(active);
    } finally {
      setAdding(false);
    }
  };

  const handleOpen = async (id: string) => {
    const active = await window.electronAPI.projects.activate(id);
    if (active) onProjectActivated(active);
  };

  const handleRemove = async (id: string) => {
    await window.electronAPI.projects.remove(id);
    const list = await window.electronAPI.projects.list();
    setProjects(list);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-y-auto bg-[#09090b] text-zinc-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-[20%] -top-[10%] h-[min(560px,70vw)] w-[min(560px,70vw)] rounded-full bg-violet-600/[0.12] blur-[100px]" />
        <div className="absolute -bottom-[15%] -right-[15%] h-[min(480px,65vw)] w-[min(480px,65vw)] rounded-full bg-sky-600/[0.1] blur-[100px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/50" />
      </div>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.4]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(ellipse 80% 60% at 50% 40%, black, transparent)',
        }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col px-8 py-16">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset] backdrop-blur-md">
            <span className="text-base font-semibold tracking-tight text-white">
              F
            </span>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">
              Flux
            </h1>
            <p className="text-[13px] text-zinc-500">Projects</p>
          </div>
        </div>

        {authSlot ? <div className="mt-8">{authSlot}</div> : null}

        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
              Local projects
            </h2>
            <button
              type="button"
              disabled={adding}
              onClick={() => void handleAdd()}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45"
            >
              {adding ? 'Opening…' : '+ Add project'}
            </button>
          </div>

          {gitError ? (
            <p
              className="mb-4 rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[13px] leading-snug text-red-300/95"
              role="alert"
            >
              That folder isn&apos;t a git repository. Run{' '}
              <code className="font-mono text-red-200">git init</code> first.
            </p>
          ) : null}

          {loading ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-6 text-center text-[13px] text-zinc-500">
              Loading…
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onAdd={() => void handleAdd()} busy={adding} />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {projects.map((p) => (
                <li key={p.id}>
                  <div className="group flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition hover:border-white/[0.12] hover:bg-white/[0.04]">
                    <button
                      type="button"
                      onClick={() => void handleOpen(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-[13px] font-medium text-zinc-300">
                        {p.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-zinc-100">
                          {p.name}
                        </div>
                        <div
                          className="truncate font-mono text-[11px] text-zinc-500"
                          title={p.rootPath}
                        >
                          {p.rootPath}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemove(p.id)}
                      className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 opacity-0 transition hover:bg-white/[0.06] hover:text-zinc-300 group-hover:opacity-100"
                      title="Remove from list"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-white/[0.06] pt-8 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-600">
          <span>Claude Code</span>
          <span className="hidden text-zinc-700 sm:inline">·</span>
          <span>Codex</span>
          <span className="hidden text-zinc-700 sm:inline">·</span>
          <span>Cursor</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onAdd, busy }: { onAdd: () => void; busy: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-10 text-center">
      <p className="max-w-sm text-[14px] leading-relaxed text-zinc-400">
        No projects yet. Add a folder with a git repository to start running
        agents on it.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onAdd}
        className="inline-flex min-h-[38px] min-w-[180px] items-center justify-center rounded-lg bg-white px-5 text-[13px] font-medium text-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset,0_1px_2px_rgba(0,0,0,0.24)] transition hover:bg-zinc-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45"
      >
        {busy ? 'Opening…' : 'Add project'}
      </button>
    </div>
  );
}
