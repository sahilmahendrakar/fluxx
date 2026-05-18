import type { ProjectRepoReadiness } from '../projectRepoReadiness';

interface Props {
  readiness: ProjectRepoReadiness;
  onOpenProjectSettings: () => void;
}

export function BoardRepoOnboardingBanner({ readiness, onOpenProjectSettings }: Props) {
  if (readiness.kind === 'ready') return null;

  const title =
    readiness.kind === 'no_repos'
      ? 'Add a repository to get started'
      : readiness.kind === 'unbound'
        ? 'Bind a local repository'
        : 'Fix repository paths';

  return (
    <div
      className="shrink-0 border-b border-sky-500/20 bg-sky-500/[0.07] px-4 py-3"
      role="status"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-sky-100/95">{title}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-sky-200/75">{readiness.message}</p>
        </div>
        <button
          type="button"
          onClick={onOpenProjectSettings}
          className="shrink-0 self-start rounded-md border border-sky-400/30 bg-sky-500/15 px-3 py-1.5 text-[12px] font-medium text-sky-50 transition hover:border-sky-300/40 hover:bg-sky-500/25 sm:self-center"
        >
          {readiness.ctaLabel}
        </button>
      </div>
    </div>
  );
}
