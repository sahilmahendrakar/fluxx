import { Cloud, Laptop } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ProjectPickerSyncBadgesProps {
  syncBadge: 'local' | 'team-synced';
}

export function ProjectPickerSyncBadges({ syncBadge }: ProjectPickerSyncBadgesProps) {
  if (syncBadge === 'team-synced') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0" tabIndex={0}>
            <Cloud
              className="size-3.5 text-status-review"
              aria-label="Team synced"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">Team synced</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0" tabIndex={0}>
          <Laptop className={cn('size-3.5 text-muted-foreground')} aria-label="Local" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Local</TooltipContent>
    </Tooltip>
  );
}
