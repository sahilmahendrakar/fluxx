import { Button } from '@/components/ui/button';
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
      className="shrink-0 border-b border-status-review/25 bg-status-review/10 px-4 py-3"
      role="status"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-status-review-foreground">{title}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-status-review-foreground/80">
            {readiness.message}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 self-start border-status-review/30 bg-status-review/15 text-status-review-foreground hover:bg-status-review/25 sm:self-center"
          onClick={onOpenProjectSettings}
        >
          {readiness.ctaLabel}
        </Button>
      </div>
    </div>
  );
}
