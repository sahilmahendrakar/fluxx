import { useEffect, useRef, useState } from 'react';
import { validateNewPlanningDocPathInput } from '../renderer/planningDocs/validateNewPlanningDocPath';

interface NewPlanningDocModalProps {
  existingRelativePaths: readonly string[];
  onClose: () => void;
  onCreate: (relativePath: string) => Promise<{ ok: true } | { ok: false; message: string }>;
}

export function NewPlanningDocModal({
  existingRelativePaths,
  onClose,
  onCreate,
}: NewPlanningDocModalProps) {
  const [pathInput, setPathInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateNewPlanningDocPathInput(pathInput, existingRelativePaths);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    setBusy(true);
    setError(null);
    const result = await onCreate(validation.relativePath);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
        className="w-[min(440px,92vw)] rounded-xl border border-white/[0.08] bg-[#0c0c0e] p-5 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-zinc-100">New planning doc</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
          Saved under{' '}
          <span className="font-mono text-zinc-400">planning/docs/</span>. Enter{' '}
          <span className="font-mono text-zinc-400">overview.md</span> or{' '}
          <span className="font-mono text-zinc-400">notes/launch-checklist.md</span>.
        </p>
        <label
          htmlFor="new-planning-doc-path"
          className="mt-4 block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500"
        >
          Path
        </label>
        <input
          id="new-planning-doc-path"
          ref={inputRef}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={pathInput}
          onChange={(e) => {
            setPathInput(e.target.value);
            if (error) setError(null);
          }}
          placeholder="e.g. overview.md"
          className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#09090b] px-3 py-2 font-mono text-[13px] text-zinc-100 outline-none focus-visible:border-white/[0.14] focus-visible:ring-1 focus-visible:ring-white/[0.12]"
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
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[13px] text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-200 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !pathInput.trim()}
            className="rounded-md border border-white/[0.12] bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-950 shadow-sm transition hover:bg-zinc-100 disabled:pointer-events-none disabled:border-transparent disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
