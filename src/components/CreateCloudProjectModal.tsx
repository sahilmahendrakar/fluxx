import { useState } from 'react';

interface Props {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}

export function CreateCloudProjectModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
        className="w-[min(420px,92vw)] rounded-xl border border-flux-border/12 bg-flux-elevated p-5 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-zinc-100">
          Create team project
        </h2>
        <p className="mt-1 text-[12px] text-zinc-500">
          You'll be the owner. Invite teammates by email after creating.
        </p>
        <label className="mt-4 block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Name
        </label>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Platform team"
          className="mt-1 w-full rounded-md border border-flux-border/12 bg-flux-surface px-3 py-2 text-[13px] text-flux-fg outline-none focus-visible:border-flux-border/20 focus-visible:ring-1 focus-visible:ring-flux-ring/15"
        />
        {error ? (
          <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-300/95">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-45"
          >
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
