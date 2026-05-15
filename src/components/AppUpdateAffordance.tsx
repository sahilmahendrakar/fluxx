import type { AppUpdateState } from '../appUpdateState';
import type { UseAppUpdatesResult } from '../renderer/useAppUpdates';

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

function UpdateDownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M8 2v8.5M8 10.5l3-3M8 10.5l-3-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 12.5h10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RestartIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M12.5 6A5 5 0 1 0 13 10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M13 4v3h-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M8 4.5V9M8 11.25v.01"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M8 2 14 13H2L8 2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
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
        className="text-white/[0.12]"
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
        className="text-sky-400/90"
      />
    </svg>
  );
}

export function AppUpdateAffordance(updates: UseAppUpdatesResult) {
  const { api, ready, state, startDownload, quitAndInstall } = updates;

  if (!api || !ready || !shouldShowUpdateChrome(state)) {
    return null;
  }

  const baseBtn =
    'flex max-w-full items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#0c0c0e]/95 px-2 py-1.5 text-left shadow-sm backdrop-blur transition';

  if (state.status === 'available') {
    const title = `Update to ${state.latestVersion} available — click to download`;
    return (
      <button
        type="button"
        className={`${baseBtn} text-zinc-400 hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-zinc-100`}
        aria-label={title}
        title={title}
        onClick={() => {
          void startDownload();
        }}
      >
        <UpdateDownloadIcon className="shrink-0 text-sky-400/90 opacity-90" />
        <span className="min-w-0 truncate text-[11px] font-medium tracking-tight text-zinc-200">
          v{state.latestVersion}
        </span>
      </button>
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
        className={`${baseBtn} cursor-default border-white/[0.06] text-zinc-400`}
        role="status"
        aria-busy
        aria-label={title}
        title={title}
      >
        {pct != null ? (
          <DownloadRingProgress percent={pct} className="shrink-0 text-zinc-500" />
        ) : (
          <DownloadRingProgress percent={35} className="shrink-0 animate-pulse text-zinc-500" />
        )}
        <span className="min-w-0 truncate font-mono text-[10px] text-zinc-300">
          {pct != null ? `${Math.round(pct)}%` : '…'}
        </span>
      </div>
    );
  }

  if (state.status === 'downloaded') {
    const title = `Restart to install v${state.latestVersion}`;
    return (
      <button
        type="button"
        className={`${baseBtn} border-emerald-500/25 text-emerald-200/95 hover:border-emerald-400/35 hover:bg-emerald-500/[0.08]`}
        aria-label={title}
        title={title}
        onClick={() => {
          void quitAndInstall();
        }}
      >
        <RestartIcon className="shrink-0 opacity-90" />
        <span className="min-w-0 truncate text-[11px] font-medium tracking-tight">
          Restart to update
        </span>
      </button>
    );
  }

  if (state.status === 'error' && state.phase === 'download') {
    const title = `Download failed — ${state.message}. Click to retry.`;
    return (
      <button
        type="button"
        className={`${baseBtn} border-red-500/20 text-red-300/95 hover:border-red-400/35 hover:bg-red-500/[0.08]`}
        aria-label={title}
        title={title}
        onClick={() => {
          void startDownload();
        }}
      >
        <AlertIcon className="shrink-0 opacity-90" />
        <span className="min-w-0 truncate text-[11px] font-medium tracking-tight">
          Retry download
        </span>
      </button>
    );
  }

  return null;
}
