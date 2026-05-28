import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  validationBoardBadgeClass,
  validationBoardBadgeLabel,
  validationBoardBadgeShortLabel,
  type ValidationBoardBadgeStatus,
} from '../../validationRuns/display';

export default function ValidationStatusBadge({
  status,
  compact = false,
  loading = false,
}: {
  status: ValidationBoardBadgeStatus;
  /** Board cards use short copy; detail panel can use full label via title. */
  compact?: boolean;
  loading?: boolean;
}) {
  const label = compact ? validationBoardBadgeShortLabel(status) : validationBoardBadgeShortLabel(status);
  const title = validationBoardBadgeLabel(status);

  return (
    <Badge
      role="status"
      title={title}
      aria-label={title}
      variant="outline"
      className={cn(
        'max-w-full gap-1 truncate rounded px-1.5 py-0.5 text-[10px] font-medium',
        validationBoardBadgeClass(status),
      )}
    >
      {loading || status === 'running' ? (
        <Loader2 className="size-3 shrink-0 animate-spin opacity-80" strokeWidth={2} aria-hidden />
      ) : null}
      <span className="truncate">{label}</span>
    </Badge>
  );
}
