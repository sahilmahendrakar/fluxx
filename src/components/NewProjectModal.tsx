import { useState } from 'react';
import {
  normalizeTeamInviteEmails,
  prepareLocalProjectCreateInput,
  projectCreateErrorMessage,
  type ProjectCreateError,
} from '../projectCreate';
import { repoRootBasename } from '../repoIdentity';
import {
  resolvePrimaryRootPath,
  suggestProjectNameFromRepo,
  type WizardRepoRow,
  wizardReposToCloudCreateInput,
  wizardReposToCreateInput,
} from './newProject/newProjectWizard';

export interface NewProjectModalCreateLocalResult {
  ok: true;
  project: import('../types').LocalProject;
}
export interface NewProjectModalCreateLocalFailure {
  ok: false;
  error: ProjectCreateError;
  message?: string;
}

export type NewProjectModalCreateLocalResponse =
  | NewProjectModalCreateLocalResult
  | NewProjectModalCreateLocalFailure;

export interface NewProjectModalProps {
  onClose: () => void;
  /** When false, team sync toggle is disabled and helper explains sign-in. */
  canUseTeamSync: boolean;
  onCreateLocal: (
    input: ReturnType<typeof prepareLocalProjectCreateInput>,
  ) => Promise<NewProjectModalCreateLocalResponse>;
  onCreateTeam: (input: {
    name: string;
    repos: ReturnType<typeof wizardReposToCloudCreateInput>;
    primaryRootPath?: string;
    teamInvites: string[];
  }) => Promise<void>;
}

type WizardStep = 'details' | 'invites';

export function NewProjectModal({
  onClose,
  canUseTeamSync,
  onCreateLocal,
  onCreateTeam,
}: NewProjectModalProps) {
  const [step, setStep] = useState<WizardStep>('details');
  const [name, setName] = useState('');
  const [nameWasEdited, setNameWasEdited] = useState(false);
  const [repos, setRepos] = useState<WizardRepoRow[]>([]);
  const [primaryRootPath, setPrimaryRootPath] = useState<string | undefined>();
  const [teamSync, setTeamSync] = useState(false);
  const [inviteEmails, setInviteEmails] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);

  const effectiveTeamSync = teamSync && canUseTeamSync;

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
    const label = repoRootBasename(rootPath) || undefined;
    const row: WizardRepoRow = {
      key: rootPath,
      rootPath,
      name: label,
      baseBranch: 'main',
    };
    setRepos((prev) => {
      const next = [...prev, row];
      if (next.length === 1) setPrimaryRootPath(rootPath);
      else if (!primaryRootPath) setPrimaryRootPath(next[0]?.rootPath);
      return next;
    });
    if (!nameWasEdited && !name.trim()) {
      const suggested = suggestProjectNameFromRepo(rootPath);
      if (suggested) setName(suggested);
    }
  };

  const runCreateLocal = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a project name.');
      return;
    }
    const payload = prepareLocalProjectCreateInput({
      name: trimmed,
      repos: wizardReposToCreateInput(repos),
      primaryRootPath: resolvePrimaryRootPath(repos, primaryRootPath),
    });
    const result = await onCreateLocal(payload);
    if (!result.ok) {
      setError(projectCreateErrorMessage(result.error, result.message));
      return;
    }
    onClose();
  };

  const runCreateTeam = async (teamInvites: string[]) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a project name.');
      return;
    }
    const inviteResult = normalizeTeamInviteEmails(teamInvites);
    if (!inviteResult.ok) {
      setError(projectCreateErrorMessage(inviteResult.error));
      return;
    }
    try {
      await onCreateTeam({
        name: trimmed,
        repos: wizardReposToCloudCreateInput(repos),
        primaryRootPath: resolvePrimaryRootPath(repos, primaryRootPath),
        teamInvites: inviteResult.emails,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the team project.');
    }
  };

  const handleDetailsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a project name.');
      return;
    }
    setError(null);
    if (effectiveTeamSync) {
      setStep('invites');
      return;
    }
    setBusy(true);
    try {
      await runCreateLocal();
    } finally {
      setBusy(false);
    }
  };

  const handleInvitesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await runCreateTeam(inviteEmails);
    } finally {
      setBusy(false);
    }
  };

  const handleSkipInvites = () => {
    setError(null);
    setBusy(true);
    void runCreateTeam([]).finally(() => setBusy(false));
  };

  if (step === 'invites') {
    return (
      <ModalBackdrop onClose={onClose}>
        <form
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => void handleInvitesSubmit(e)}
          className="w-[min(480px,92vw)] rounded-xl border border-white/[0.08] bg-[#0c0c0e] p-5 shadow-2xl"
        >
          <h2 className="text-[15px] font-semibold text-zinc-100">Invite teammates</h2>
          <p className="mt-1 text-[12px] text-zinc-500">
            Optional. Teammates receive an email invite to this project.
          </p>

          <div className="mt-4 flex flex-col gap-2">
            {inviteEmails.map((value, index) => (
              <input
                key={index}
                type="email"
                value={value}
                onChange={(e) => {
                  const next = [...inviteEmails];
                  next[index] = e.target.value;
                  setInviteEmails(next);
                }}
                placeholder="name@company.com"
                className="w-full rounded-md border border-white/[0.08] bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 outline-none focus-visible:border-white/[0.14] focus-visible:ring-1 focus-visible:ring-white/[0.12]"
              />
            ))}
            <button
              type="button"
              onClick={() => setInviteEmails((prev) => [...prev, ''])}
              className="mt-1 self-start text-[12px] font-medium text-zinc-400 transition hover:text-zinc-200"
            >
              Add another
            </button>
          </div>

          {error ? <ErrorBanner message={error} /> : null}

          <div className="mt-5 flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                setStep('details');
              }}
              className="rounded-md px-3 py-1.5 text-[12px] text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-200 disabled:opacity-45"
            >
              Back
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleSkipInvites}
                className="rounded-md px-3 py-1.5 text-[12px] text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-200 disabled:opacity-45"
              >
                Skip for now
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-45"
              >
                {busy ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </div>
        </form>
      </ModalBackdrop>
    );
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleDetailsSubmit(e)}
        className="w-[min(480px,92vw)] rounded-xl border border-white/[0.08] bg-[#0c0c0e] p-5 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-zinc-100">New project</h2>

        <label className="mt-4 block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Project name
        </label>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => {
            setNameWasEdited(true);
            setName(e.target.value);
          }}
          placeholder="e.g. Payments redesign"
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

        <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium text-zinc-200">Team sync</div>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {effectiveTeamSync
                  ? 'Share tasks and planning docs with teammates.'
                  : canUseTeamSync
                    ? 'Keep this project on this device only.'
                    : 'Sign in to share tasks and planning docs with teammates.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={effectiveTeamSync}
              disabled={!canUseTeamSync || busy}
              onClick={() => setTeamSync((v) => !v)}
              className={`relative h-6 w-10 shrink-0 rounded-full transition disabled:opacity-40 ${
                effectiveTeamSync ? 'bg-sky-500/80' : 'bg-white/10'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                  effectiveTeamSync ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        {error ? <ErrorBanner message={error} /> : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[12px] text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-200 disabled:opacity-45"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-45"
          >
            {busy ? 'Creating…' : effectiveTeamSync ? 'Continue' : 'Create project'}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

function ModalBackdrop({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      {children}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-300/95">
      {message}
    </p>
  );
}

function ReposSection(props: {
  repoError: string | null;
  repos: WizardRepoRow[];
  setRepos: React.Dispatch<React.SetStateAction<WizardRepoRow[]>>;
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
      {repoError ? <ErrorBanner message={repoError} /> : null}
      {repos.length === 0 ? (
        <p className="mt-2 text-[12px] text-zinc-500">No repositories attached.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {repos.map((repo) => (
            <li
              key={repo.key}
              className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-zinc-200">
                    {repo.name ?? repoRootBasename(repo.rootPath) ?? 'Repository'}
                  </div>
                  <div
                    className="truncate font-mono text-[11px] text-zinc-500"
                    title={repo.rootPath}
                  >
                    {repo.rootPath}
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-600">
                    Default branch: {repo.baseBranch ?? 'main'}
                  </p>
                </div>
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
              </div>
            </li>
          ))}
        </ul>
      )}
      {repos.length >= 2 ? (
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
      ) : null}
    </>
  );
}
