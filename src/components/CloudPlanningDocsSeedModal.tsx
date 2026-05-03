import { useEffect } from 'react';

interface Props {
  projectName: string;
  localDocCount: number;
  busy: boolean;
  onUploadToCloud: () => void;
  onSkip: () => void;
}

/**
 * One-time offer when Firestore planning docs are empty but the local mirror has files.
 */
export function CloudPlanningDocsSeedModal({
  projectName,
  localDocCount,
  busy,
  onUploadToCloud,
  onSkip,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkip]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onMouseDown={() => !busy && onSkip()}
    >
      <div
        className="w-full max-w-[440px] rounded-lg border border-white/[0.08] bg-[#101012] p-5 shadow-2xl shadow-black/40"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
      >
        <h2 className="text-[15px] font-medium tracking-tight text-zinc-100">
          Initialize shared planning docs?
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
          Cloud project <span className="text-zinc-200">{projectName}</span> has no shared planning
          documents yet, but this machine already has{' '}
          <span className="text-zinc-200">{localDocCount}</span> markdown file
          {localDocCount === 1 ? '' : 's'} under planning.
        </p>
        <ul className="mt-3 space-y-1 text-[13px] text-zinc-300">
          <li className="flex items-start gap-2">
            <span className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-zinc-500" aria-hidden />
            <span>
              <strong className="font-medium text-zinc-200">Upload from this folder</strong> copies your
              local planning markdown into the shared cloud docs teammates will see.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-zinc-500" aria-hidden />
            <span>
              <strong className="font-medium text-zinc-200">Not now</strong> leaves the cloud empty until
              someone else initializes docs or you upload later — nothing is overwritten silently.
            </span>
          </li>
        </ul>
        <p className="mt-3 text-[12px] leading-snug text-zinc-500">
          Files under <code className="text-zinc-400">_flux_unsynced/</code> are never uploaded.
        </p>
        <div className="mt-6 flex justify-end gap-2 border-t border-white/[0.06] pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={onSkip}
            className="rounded-md px-3 py-1.5 text-[13px] text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-200 disabled:opacity-40"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onUploadToCloud}
            className="rounded-md border border-white/[0.12] bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-950 shadow-sm transition hover:bg-zinc-100 disabled:opacity-40"
          >
            {busy ? 'Uploading…' : 'Upload from this folder'}
          </button>
        </div>
      </div>
    </div>
  );
}
