import { useState } from 'react';
import type { Project } from '../types';

interface WelcomeScreenProps {
  onProjectOpened: (project: Project) => void;
}

export function WelcomeScreen({ onProjectOpened }: WelcomeScreenProps) {
  const [opening, setOpening] = useState(false);
  const [gitError, setGitError] = useState(false);

  const handleOpen = async () => {
    setGitError(false);
    setOpening(true);
    try {
      const result = await window.electronAPI.project.open();
      if (result && !('error' in result)) {
        onProjectOpened(result);
      } else if (result && 'error' in result && result.error === 'NOT_GIT_REPO') {
        setGitError(true);
      }
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-[#09090b] text-zinc-100">
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
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 40%, black, transparent)',
        }}
      />

      <div className="relative z-10 flex w-full max-w-lg flex-col items-center px-8 text-center">
        <div className="mb-8 flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset] backdrop-blur-md">
          <span className="text-lg font-semibold tracking-tight text-white">F</span>
        </div>

        <h1 className="text-[2.75rem] font-semibold leading-none tracking-[-0.04em] text-white sm:text-7xl sm:tracking-[-0.045em]">
          Flux
        </h1>
        <p className="mt-5 max-w-[22rem] text-[15px] leading-relaxed text-zinc-500 sm:max-w-md sm:text-base sm:leading-relaxed">
          Run AI agents on a kanban of tasks—each with its own git worktree and terminal session.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <button
            type="button"
            disabled={opening}
            onClick={() => void handleOpen()}
            className="inline-flex min-h-[42px] min-w-[200px] items-center justify-center rounded-lg bg-white px-6 text-sm font-medium text-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset,0_1px_2px_rgba(0,0,0,0.24)] transition hover:bg-zinc-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45"
          >
            {opening ? 'Opening…' : 'Open project'}
          </button>
        </div>
        <p className="mt-3 text-[13px] text-zinc-600">Choose a folder with a git repository</p>

        {gitError ? (
          <p
            className="mt-6 max-w-sm rounded-lg border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-sm leading-snug text-red-300/95"
            role="alert"
          >
            That folder isn&apos;t a git repository. Run git init first.
          </p>
        ) : null}

        <div className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-white/[0.06] pt-8 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-600">
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
