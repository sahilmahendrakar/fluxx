import { useEffect } from 'react';

interface ConfirmDialogProps {
  title: string;
  description: string;
  bullets?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  description,
  bullets,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

  const confirmClass = destructive
    ? 'rounded-md border border-red-500/30 bg-red-500/[0.12] px-3 py-1.5 text-[13px] font-medium text-red-100 shadow-sm transition hover:bg-red-500/[0.18]'
    : 'rounded-md border border-flux-border/15 bg-flux-fg px-3 py-1.5 text-[13px] font-medium text-flux-canvas shadow-sm transition hover:bg-flux-fg/90';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-[420px] rounded-lg border border-flux-border/12 bg-flux-elevated p-5 shadow-2xl shadow-black/25"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-[15px] font-medium tracking-tight text-flux-fg">{title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-flux-fg-muted">{description}</p>
        {bullets && bullets.length > 0 ? (
          <ul className="mt-3 space-y-1 text-[13px] text-flux-fg-muted">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <span className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-flux-fg-subtle" aria-hidden />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-6 flex justify-end gap-2 border-t border-flux-border/10 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[13px] text-flux-fg-subtle transition hover:bg-flux-hover/6 hover:text-flux-fg"
          >
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={confirmClass}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
