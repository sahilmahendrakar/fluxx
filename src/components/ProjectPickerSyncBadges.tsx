import { Cloud, Laptop } from 'lucide-react';

interface ProjectPickerSyncBadgesProps {
  syncBadge: 'local' | 'team-synced';
}

export function ProjectPickerSyncBadges({ syncBadge }: ProjectPickerSyncBadgesProps) {
  if (syncBadge === 'team-synced') {
    return (
      <Cloud
        className="h-3.5 w-3.5 shrink-0 text-sky-300/80"
        aria-label="Team synced"
        title="Team synced"
      />
    );
  }

  return (
    <Laptop
      className="h-3.5 w-3.5 shrink-0 text-zinc-400"
      aria-label="Local"
      title="Local"
    />
  );
}
