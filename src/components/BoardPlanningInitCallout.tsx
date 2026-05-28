import { Button } from '@/components/ui/button';

interface Props {
  onStart: () => void;
  onSkip: () => void;
  busy?: boolean;
}

export function BoardPlanningInitCallout({ onStart, onSkip, busy = false }: Props) {
  return (
    <div
      className="shrink-0 border-b border-primary/25 bg-primary/10 px-4 py-3"
      role="region"
      aria-label="Initialize project context"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-primary">Initialize project context?</p>
          <p className="mt-1 text-[12px] leading-relaxed text-primary/80">
            Start the planning assistant to draft vision and architecture docs from your repos
            and goals.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-center">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={onStart}
          >
            Start planning assistant
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onSkip}
          >
            Skip
          </Button>
        </div>
      </div>
    </div>
  );
}
