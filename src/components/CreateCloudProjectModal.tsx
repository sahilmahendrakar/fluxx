import { useState } from 'react';
import type { CloudProjectCreateRepoInput } from '../renderer/projects/cloudProjects';
import { repoRootBasename } from '../repoIdentity';

interface Props {
  onClose: () => void;
  onCreate: (input: {
    name: string;
    repos: CloudProjectCreateRepoInput[];
    primaryRootPath?: string;
  }) => Promise<void>;
}

type CreateRepoRow = CloudProjectCreateRepoInput & { key: string };

export function CreateCloudProjectModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [repos, setRepos] = useState<CreateRepoRow[]>([]);
  const [primaryRootPath, setPrimaryRootPath] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);

  const handleAddRepo = async () => {
    setRepoError(null);
    const picked = await window.electronAPI.project.pickRepoDirectory();
    if (!picked) return;
    if ('error' in picked) {
      if (picked.error === 'NOT_GIT_REPO') {
        setRepoError('That folder isn’t a git repository. Run git init first.');
      } else {
        setRepoError(typeof picked.error === 'string' ? picked.error : 'Could not add repository.');
      }
      return;
    }
    const rootPath = picked.rootPath;
    if (repos.some((r) => r.rootPath === rootPath)) {
      setRepoError('That repository is already attached.');
      return;
    }
    const row: CreateRepoRow = {
      key: rootPath,
      rootPath,
      name: repoRootBasename(rootPath) || undefined,
    };
    setRepos((prev) => {
      const next = [...prev, row];
      if (next.length === 1) setPrimaryRootPath(rootPath);
      else if (!primaryRootPath) setPrimaryRootPath(next[0]?.rootPath);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: trimmed,
        repos: repos.map(({ rootPath, name: repoName, baseBranch }) => ({
          rootPath,
          ...(repoName ? { name: repoName } : {}),
          ...(baseBranch ? { baseBranch } : {}),
        })),
        primaryRootPath:
          repos.length >= 2 ? primaryRootPath : repos.length === 1 ? repos[0].rootPath : undefined,
      });
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
        className="w-[min(480px,92vw)] rounded-xl border border-white/[0.08] bg-[#0c0c0e] p-5 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-zinc-100">Create team project</h2>
        <p className="mt-1 text-[12px] text-zinc-500">
          You&apos;ll be the owner. Attach repositories now or add them later in project settings.
        </p>

        <label className="mt-4 block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Project name
        </label>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Platform team"
          className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 outline-none focus-visible:border-white/[0.14] focus-visible:ring-1 focus-visible:ring-white/[0.12]"
        />

        <ReposSection
          repoError={repoError}
          repos={repos}
          setRepos={setRepos}
          primaryRootPath={primaryRootPath}
          setPrimaryRootPath={setPrimaryRootPath}
          onAddRepo={() => void handleAddRepo()}
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

function ReposSection(props: {
  repoError: string | null;
  repos: CreateRepoRow[];
  setRepos: React.Dispatch<React.SetStateAction<CreateRepoRow[]>>;
  primaryRootPath: string | undefined;
  setPrimaryRootPath: (v: string | undefined) => void;
  onAddRepo: () => void;
}) {
  const { repoError, repos, setRepos, primaryRootPath, setPrimaryRootPath, onAddRepo } = props;

  return (
    <>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Repositories
        </span>
        <button
          type="button"
          onClick={onAddRepo}
          className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-white/[0.06]"
        >
          Add repository
        </button>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        Attach git repositories now, or add them later in project settings.
      </p>
      {repoError ? (
        <p className="mt-2 rounded-md border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-300/95">
          {repoError}
        </p>
      ) : null}
      {repos.length === 0 ? (
        <p className="mt-2 text-[12px] text-zinc-500">No repositories attached.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {repos.map((repo) => (
            <li
              key={repo.key}
              className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">
                {repo.rootPath}
              </span>
              <button
                type="button"
                onClick={() => {
                  setRepos((prev) => {
                    const next = prev.filter((r) => r.key !== repo.key);
                    if (primaryRootPath === repo.rootPath) {
                      setPrimaryRootPath(next[0]?.rootPath);
                    }
                    return next;
                  });
                }}
                className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {repos.length >= 2 ? (
        <PrimaryRepoSelector
          repos={repos}
          primaryRootPath={primaryRootPath}
          setPrimaryRootPath={setPrimaryRootPath}
        />
      ) : null}
    </>
  );
}

function PrimaryRepoSelector(props: {
  repos: CreateRepoRow[];
  primaryRootPath: string | undefined;
  setPrimaryRootPath: (v: string | undefined) => void;
}) {
  const { repos, primaryRootPath, setPrimaryRootPath } = props;
  return (
    <div className="mt-3">
      <label className="block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
        Primary repository
      </label>
      <select
        value={primaryRootPath ?? ''}
        onChange={(e) => setPrimaryRootPath(e.target.value || undefined)}
        className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#09090b] px-2 py-1.5 text-[12px] text-zinc-100"
      >
        {repos.map((r) => (
          <option key={r.key} value={r.rootPath}>
            {r.name ?? repoRootBasename(r.rootPath) ?? r.rootPath}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-zinc-500">
        Used for default task workspaces and planning context.
      </p>
    </div>
  );
}
