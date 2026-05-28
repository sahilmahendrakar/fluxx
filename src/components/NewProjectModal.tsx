import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '../renderer/auth/useAuth';
import {
  normalizeTeamInviteEmails,
  projectCreateErrorMessage,
  type ProjectCreateError,
  type ProjectCreateWizardPayload,
} from '../projectCreate';
import { repoRootBasename } from '../repoIdentity';
import {
  resolvePrimaryRootPath,
  suggestProjectNameFromRepo,
  type WizardRepoRow,
  wizardReposToCloudCreateInput,
  wizardReposToCreateInput,
} from './newProject/newProjectWizard';
import {
  removeInviteEmailAtIndex,
  shouldShowInviteStep,
} from './newProject/newProjectTeamInvites';

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
  onCreateLocal: (
    input: ProjectCreateWizardPayload,
  ) => Promise<NewProjectModalCreateLocalResponse>;
  onCreateTeam: (input: {
    name: string;
    repos: ReturnType<typeof wizardReposToCloudCreateInput>;
    primaryRootPath?: string;
    teamInvites: string[];
  }) => Promise<{ inviteWarnings: string[] }>;
}

type WizardStep = 'details' | 'invites';

export function NewProjectModal({
  onClose,
  onCreateLocal,
  onCreateTeam,
}: NewProjectModalProps) {
  const auth = useAuth();
  const signedIn = auth.status === 'signedIn';
  const [step, setStep] = useState<WizardStep>('details');
  const [name, setName] = useState('');
  const [nameWasEdited, setNameWasEdited] = useState(false);
  const [repos, setRepos] = useState<WizardRepoRow[]>([]);
  const [primaryRootPath, setPrimaryRootPath] = useState<string | undefined>();
  const [teamSync, setTeamSync] = useState(false);
  const [teamSyncAfterSignIn, setTeamSyncAfterSignIn] = useState(false);
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [inviteEmails, setInviteEmails] = useState<string[]>(['']);
  const [inviteWarnings, setInviteWarnings] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);

  useEffect(() => {
    if (signedIn && teamSyncAfterSignIn) {
      setTeamSync(true);
      setTeamSyncAfterSignIn(false);
    }
  }, [signedIn, teamSyncAfterSignIn]);

  const effectiveTeamSync = teamSync && signedIn;

  const handleSignInForTeamSync = async () => {
    if (auth.status === 'unconfigured' || auth.status === 'loading') return;
    setSignInError(null);
    setSignInBusy(true);
    try {
      await auth.signIn();
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : String(err));
    } finally {
      setSignInBusy(false);
    }
  };

  const handleTeamSyncToggle = () => {
    if (signedIn) {
      setTeamSync((v) => !v);
      return;
    }
    setTeamSyncAfterSignIn(true);
    void handleSignInForTeamSync();
  };

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
    const payload: ProjectCreateWizardPayload = {
      name: trimmed,
      repos: wizardReposToCreateInput(repos),
      primaryRootPath: resolvePrimaryRootPath(repos, primaryRootPath),
    };
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
      const result = await onCreateTeam({
        name: trimmed,
        repos: wizardReposToCloudCreateInput(repos),
        primaryRootPath: resolvePrimaryRootPath(repos, primaryRootPath),
        teamInvites: inviteResult.emails,
      });
      if (result.inviteWarnings.length > 0) {
        setInviteWarnings(result.inviteWarnings);
        return;
      }
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
    if (shouldShowInviteStep(effectiveTeamSync, signedIn)) {
      setStep('invites');
      return;
    }
    setBusy(true);
    try {
      await runCreateLocal();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Could not create the project.');
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(480px,92vw)]">
        {step === 'invites' ? (
          <form onSubmit={(e) => void handleInvitesSubmit(e)}>
            <DialogHeader>
              <DialogTitle>Invite teammates</DialogTitle>
              <DialogDescription>
                Optional. Teammates receive an email invite to this project.
              </DialogDescription>
            </DialogHeader>

            {inviteWarnings ? (
              <div className="flex flex-col gap-3 py-4">
                <Alert className="border-status-success/30 bg-status-success/10 text-status-success-foreground">
                  <AlertDescription>Project created. Your board is ready.</AlertDescription>
                </Alert>
                <ul className="flex flex-col gap-2">
                  {inviteWarnings.map((warning) => (
                    <li key={warning}>
                      <Alert className="border-status-needs-input/30 bg-status-needs-input/10 text-status-needs-input-foreground">
                        <AlertDescription>{warning}</AlertDescription>
                      </Alert>
                    </li>
                  ))}
                </ul>
                <DialogFooter>
                  <Button type="button" onClick={onClose}>
                    Done
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2 py-4">
                  {inviteEmails.map((value, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        type="email"
                        value={value}
                        onChange={(e) => {
                          const next = [...inviteEmails];
                          next[index] = e.target.value;
                          setInviteEmails(next);
                        }}
                        placeholder="name@company.com"
                        aria-label={
                          inviteEmails.length > 1
                            ? `Teammate email ${index + 1}`
                            : 'Teammate email'
                        }
                      />
                      {inviteEmails.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label="Remove email"
                          onClick={() =>
                            setInviteEmails((prev) => removeInviteEmailAtIndex(prev, index))
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto self-start px-0 text-xs"
                    onClick={() => setInviteEmails((prev) => [...prev, ''])}
                  >
                    Add another
                  </Button>
                </div>

                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setStep('details');
                    }}
                  >
                    Back
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={handleSkipInvites}
                    >
                      Skip for now
                    </Button>
                    <Button type="submit" disabled={busy}>
                      {busy ? 'Creating…' : 'Create project'}
                    </Button>
                  </div>
                </DialogFooter>
              </>
            )}
          </form>
        ) : (
          <form onSubmit={(e) => void handleDetailsSubmit(e)}>
            <DialogHeader>
              <DialogTitle>New project</DialogTitle>
              <DialogDescription>
                Create a local project or enable cloud sync for your team.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="new-project-name"
                  className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Project name
                </Label>
                <Input
                  id="new-project-name"
                  type="text"
                  autoFocus
                  value={name}
                  onChange={(e) => {
                    setNameWasEdited(true);
                    setName(e.target.value);
                  }}
                  placeholder="e.g. Payments redesign"
                />
              </div>

              <ReposSection
                repoError={repoError}
                repos={repos}
                setRepos={setRepos}
                primaryRootPath={primaryRootPath}
                setPrimaryRootPath={setPrimaryRootPath}
                onAddRepo={() => void handleAddRepo()}
              />

              <TeamSyncSection
                authStatus={auth.status}
                effectiveTeamSync={effectiveTeamSync}
                signInBusy={signInBusy}
                signInError={signInError}
                formBusy={busy}
                onToggle={handleTeamSyncToggle}
                onSignIn={() => void handleSignInForTeamSync()}
              />

              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? 'Creating…' : effectiveTeamSync ? 'Continue' : 'Create project'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TeamSyncSection(props: {
  authStatus: ReturnType<typeof useAuth>['status'];
  effectiveTeamSync: boolean;
  signInBusy: boolean;
  signInError: string | null;
  formBusy: boolean;
  onToggle: () => void;
  onSignIn: () => void;
}) {
  const {
    authStatus,
    effectiveTeamSync,
    signInBusy,
    signInError,
    formBusy,
    onToggle,
    onSignIn,
  } = props;
  const signedIn = authStatus === 'signedIn';
  const showSignIn = authStatus === 'signedOut';

  const helper = effectiveTeamSync
    ? 'Share tasks and planning docs with teammates.'
    : signedIn
      ? 'Keep this project on this device only.'
      : authStatus === 'unconfigured'
        ? 'Cloud sync requires Firebase and Google sign-in in .env.local.'
        : 'Sign in to share tasks and planning docs with teammates.';

  const toggleDisabled =
    formBusy || signInBusy || authStatus === 'loading' || authStatus === 'unconfigured';

  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">Cloud sync</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{helper}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showSignIn ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={signInBusy || formBusy}
              onClick={onSignIn}
              className="h-8 gap-1.5 text-[11px]"
            >
              <GoogleGlyph />
              {signInBusy ? 'Signing in…' : 'Sign in'}
            </Button>
          ) : null}
          {signedIn || showSignIn ? (
            <Switch
              checked={effectiveTeamSync}
              disabled={toggleDisabled}
              onCheckedChange={onToggle}
              aria-label={signedIn ? 'Cloud sync' : 'Enable cloud sync after sign-in'}
            />
          ) : (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {authStatus === 'loading' ? 'Checking…' : 'Unavailable'}
            </span>
          )}
        </div>
      </div>
      {signInError ? (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription>{signInError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 18 18" aria-hidden className="shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A9 9 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A9 9 0 0 0 .957 4.961l3.007 2.332C4.672 5.166 6.656 3.58 9 3.58z"
      />
    </svg>
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Repositories
        </Label>
        <Button type="button" variant="outline" size="sm" onClick={onAddRepo}>
          Add repository
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Attach git repositories now, or add them later in project settings.
      </p>
      {repoError ? (
        <Alert variant="destructive">
          <AlertDescription>{repoError}</AlertDescription>
        </Alert>
      ) : null}
      {repos.length === 0 ? (
        <p className="text-xs text-muted-foreground">No repositories attached.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {repos.map((repo) => (
            <li
              key={repo.key}
              className="rounded-md border bg-muted/20 px-2.5 py-2"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    {repo.name ?? repoRootBasename(repo.rootPath) ?? 'Repository'}
                  </div>
                  <div
                    className="truncate font-mono text-[11px] text-muted-foreground"
                    title={repo.rootPath}
                  >
                    {repo.rootPath}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Default branch: {repo.baseBranch ?? 'main'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto shrink-0 px-2 text-[11px]"
                  onClick={() => {
                    setRepos((prev) => {
                      const next = prev.filter((r) => r.key !== repo.key);
                      if (primaryRootPath === repo.rootPath) {
                        setPrimaryRootPath(next[0]?.rootPath);
                      }
                      return next;
                    });
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {repos.length >= 2 ? (
        <div className="flex flex-col gap-2">
          <Label
            htmlFor="new-project-primary-repo"
            className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
          >
            Primary repository
          </Label>
          <Select
            value={primaryRootPath ?? ''}
            onValueChange={(value) => setPrimaryRootPath(value || undefined)}
          >
            <SelectTrigger id="new-project-primary-repo" className="h-9 text-xs">
              <SelectValue placeholder="Select repository" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {repos.map((r) => (
                  <SelectItem key={r.key} value={r.rootPath}>
                    {r.name ?? repoRootBasename(r.rootPath) ?? r.rootPath}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Used for default task workspaces and planning context.
          </p>
        </div>
      ) : null}
    </div>
  );
}
