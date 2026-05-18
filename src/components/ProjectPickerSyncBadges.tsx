interface ProjectPickerSyncBadgesProps {
  syncBadge: 'local' | 'team-synced';
  needsRepo?: boolean;
}

export function ProjectPickerSyncBadges({
  syncBadge,
  needsRepo,
}: ProjectPickerSyncBadgesProps) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {syncBadge === 'local' ? (
        <span className="rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Local
        </span>
      ) : (
        <span className="rounded border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-200/90">
          Team synced
        </span>
      )}
      {needsRepo ? (
        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200/90">
          Needs repo
        </span>
      ) : null}
    </span>
  );
}
