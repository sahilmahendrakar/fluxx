interface Props {
  onStart: () => void;
  onSkip: () => void;
  busy?: boolean;
}

export function BoardPlanningInitCallout({ onStart, onSkip, busy = false }: Props) {
  return (
    <div
      className="shrink-0 border-b border-violet-500/20 bg-violet-500/[0.07] px-4 py-3"
      role="region"
      aria-label="Initialize project context"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-violet-100/95">
            Initialize project context?
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-violet-200/75">
            Start the planning assistant to draft vision and architecture docs from your repos
            and goals.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-center">
          <button
            type="button"
            disabled={busy}
            onClick={onStart}
            className="rounded-md border border-violet-400/35 bg-violet-500/20 px-3 py-1.5 text-[12px] font-medium text-violet-50 transition hover:border-violet-300/45 hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start planning assistant
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSkip}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-[12px] text-gray-400 transition hover:border-gray-600 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
