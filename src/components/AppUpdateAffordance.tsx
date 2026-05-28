import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import type { AppUpdateState } from '../appUpdateState';
import type { UseAppUpdatesResult } from '../renderer/useAppUpdates';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function shouldShowUpdateChrome(state: AppUpdateState): boolean {
  switch (state.status) {
    case 'available':
    case 'downloading':
    case 'downloaded':
      return true;
    case 'error':
      return state.phase === 'download';
    default:
      return false;
  }
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

function DownloadRingProgress({
  percent,
  className,
}: {
  percent: number;
  className?: string;
}) {
  const r = 6.5;
  const c = 2 * Math.PI * r;
  const strokeDashoffset = c - (percent / 100) * c;
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      aria-hidden
    >
      <circle
        cx={8}
        cy={8}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        className="text-muted-foreground/30"
      />
      <circle
        cx={8}
        cy={8}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeDasharray={c}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
        className="text-status-review"
      />
    </svg>
  );
}

const updateButtonClass =
  'h-auto max-w-full justify-start gap-1.5 rounded-lg border-border/80 bg-card/95 px-2 py-1.5 text-left text-[11px] font-medium shadow-sm backdrop-blur';

export function AppUpdateAffordance(updates: UseAppUpdatesResult) {
  const { api, ready, state, startDownload, quitAndInstall } = updates;

  if (!api || !ready || !shouldShowUpdateChrome(state)) {
    return null;
  }

  if (state.status === 'available') {
    const title = `Update to ${state.latestVersion} available — click to download`;
    return (
      <Button
        type="button"
        variant="outline"
        className={cn(updateButtonClass, 'text-muted-foreground hover:text-foreground')}
        aria-label={title}
        title={title}
        onClick={() => {
          void startDownload();
        }}
      >
        <Download className="text-status-review" data-icon="inline-start" />
        <span className="min-w-0 truncate tracking-tight">v{state.latestVersion}</span>
      </Button>
    );
  }

  if (state.status === 'downloading') {
    const pct = Number.isFinite(state.percent)
      ? Math.min(100, Math.max(0, state.percent))
      : null;
    const xfer =
      state.total > 0
        ? `${formatBytes(state.transferred)} / ${formatBytes(state.total)}`
        : '';
    const title = [
      pct != null ? `${Math.round(pct)}% downloaded` : 'Downloading update',
      xfer,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div
        className={cn(updateButtonClass, 'flex cursor-default items-center text-muted-foreground')}
        role="status"
        aria-busy
        aria-label={title}
        title={title}
      >
        {pct != null ? (
          <DownloadRingProgress percent={pct} className="shrink-0" />
        ) : (
          <DownloadRingProgress percent={35} className="shrink-0 animate-pulse" />
        )}
        <span className="min-w-0 truncate font-mono text-[10px] text-foreground/90">
          {pct != null ? `${Math.round(pct)}%` : '…'}
        </span>
      </div>
    );
  }

  if (state.status === 'downloaded') {
    const title = `Restart to install v${state.latestVersion}`;
    return (
      <Button
        type="button"
        variant="outline"
        className={cn(
          updateButtonClass,
          'border-status-success/30 text-status-success-foreground hover:bg-status-success/10',
        )}
        aria-label={title}
        title={title}
        onClick={() => {
          void quitAndInstall();
        }}
      >
        <RotateCcw data-icon="inline-start" />
        <span className="min-w-0 truncate tracking-tight">Restart to update</span>
      </Button>
    );
  }

  if (state.status === 'error' && state.phase === 'download') {
    const title = `Download failed — ${state.message}. Click to retry.`;
    return (
      <Button
        type="button"
        variant="outline"
        className={cn(
          updateButtonClass,
          'border-destructive/30 text-destructive hover:bg-destructive/10',
        )}
        aria-label={title}
        title={title}
        onClick={() => {
          void startDownload();
        }}
      >
        <AlertTriangle data-icon="inline-start" />
        <span className="min-w-0 truncate tracking-tight">Retry download</span>
      </Button>
    );
  }

  return null;
}
